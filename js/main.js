/**
 * Bootstrap: scelta fazione → draft → torneo → tirate.
 *
 * Tutte le partite, giocate o simulate, passano dallo stesso motore fisico:
 * gli incontri fra IA girano headless con `simulateFixture`.
 */

import { FACTIONS, getFaction, STAT_LABEL } from './data/factions.js';
import { generatePool, generateAiRoster } from './core/roster.js';
import { makeRng, randomSeed } from './core/rng.js';
import {
  getState, setState, mutate, newTournamentState, loadSave, clearSave, getPreset, PRESETS,
} from './core/state.js';
import {
  buildSchedule, ALL_FACTION_IDS, recordResult, currentDay, isGroupComplete,
  computeStandings, buildFinals, nextFinal, isFinalsComplete, allFixtures,
} from './core/tournament.js';
import { showScreen, el } from './ui/screens.js';
import { mountRoster } from './ui/rosterUI.js';
import { renderTournament } from './ui/calendarUI.js';
import { playMatch, simulateFixture, buildTeam } from './match/match.js';

const $ = (id) => document.getElementById(id);

let selectedFaction = null;
let selectedPreset = 'rapida';
let selectedMode = 'single';       // 'single' | 'duo'

// Scelte di draft accumulate: uno solo a giocatore singolo, due in coppia.
let picks = [];                    // [{ factionId, roster }]
let draftSeed = null;              // seme della prima rosa, riusato come seme torneo

/* ==================== schermata fazione ==================== */

/**
 * Disegna la scelta del quartiere. In coppia la si mostra due volte: al secondo
 * giro `taken` esclude il quartiere già preso e `playerNo` cambia il titolo.
 */
function renderFactionScreen({ playerNo = 1, taken = [] } = {}) {
  const grid = $('faction-grid');
  grid.replaceChildren();

  const firstPick = playerNo === 1;
  $('faction-title').textContent = firstPick ? 'Palio del Timone' : 'Giocatore 2';
  $('faction-subtitle').textContent = firstPick
    ? 'Scegli il quartiere che chiamerai alla tirata.'
    : 'Scegli il secondo quartiere: gli altri due li chiamerà l’IA.';

  // Modalità, formato e ripresa si scelgono una volta sola, al primo giocatore.
  $('mode-bar').hidden = !firstPick;
  $('preset-options').closest('.preset-bar').hidden = !firstPick;

  for (const f of FACTIONS) {
    const card = el('button', 'faction-card');
    card.type = 'button';
    card.style.setProperty('--fc', f.color);
    card.dataset.id = f.id;

    const crest = el('div', 'faction-crest');
    const name = el('div', 'faction-name', f.name);
    const color = el('div', 'faction-color', f.colorName);
    const bonus = el('div', 'faction-bonus');
    bonus.append(
      el('strong', null, `+10% ${bonusLabel(f.bonusStat)}`),
      el('div', null, f.motto),
    );
    card.append(crest, name, color, bonus);

    if (taken.includes(f.id)) {
      card.disabled = true;
      card.classList.add('is-taken');
      card.title = 'Già scelto dal Giocatore 1';
    } else {
      card.addEventListener('click', () => {
        selectedFaction = f.id;
        for (const c of grid.children) c.classList.toggle('is-selected', c.dataset.id === f.id);
        $('btn-faction-confirm').disabled = false;
        document.documentElement.style.setProperty('--fc', f.color);
      });
    }
    grid.append(card);
  }

  if (firstPick) wireModeAndPreset();

  const resume = $('btn-continue-save');
  const save = firstPick ? loadSave() : null;
  resume.hidden = !save;
  if (save) {
    const who = save.mode === 'duo'
      ? save.humans.map((id) => getFaction(id).name).join(' e ')
      : getFaction(save.factionId).name;
    resume.textContent = `Riprendi torneo · ${who}`;
    resume.onclick = () => { setState(save, { save: false }); goToTournament(); };
  }

  $('btn-faction-confirm').onclick = () => {
    if (selectedFaction) startDraft(selectedFaction, playerNo);
  };
}

/** Collega i pulsanti di modalità e formato allo stato corrente. */
function wireModeAndPreset() {
  for (const btn of $('mode-options').querySelectorAll('.preset-btn')) {
    btn.classList.toggle('is-active', btn.dataset.mode === selectedMode);
    btn.onclick = () => {
      selectedMode = btn.dataset.mode;
      for (const b of $('mode-options').children) b.classList.toggle('is-active', b === btn);
    };
  }
  for (const btn of $('preset-options').querySelectorAll('.preset-btn')) {
    btn.classList.toggle('is-active', btn.dataset.preset === selectedPreset);
    btn.onclick = () => {
      selectedPreset = btn.dataset.preset;
      for (const b of $('preset-options').children) b.classList.toggle('is-active', b === btn);
    };
  }
}

const bonusLabel = (stat) => STAT_LABEL[stat] ?? stat;

/* ==================== draft ==================== */

function startDraft(factionId, playerNo) {
  draftSeed = draftSeed ?? randomSeed();
  // Ogni giocatore pesca dal proprio mazzo: due rose non si contendono gli
  // stessi tiratori. Il primo seme è anche quello del torneo.
  const poolSeed = playerNo === 1 ? draftSeed : (draftSeed ^ 0x9e3779b1) >>> 0;
  const pool = generatePool(poolSeed);
  mountRoster({
    pool,
    factionId,
    playerNo: selectedMode === 'duo' ? playerNo : null,
    onConfirm: (roster) => onDraftDone(factionId, roster),
  });
  showScreen('roster');
}

function onDraftDone(factionId, roster) {
  picks.push({ factionId, roster });

  // In coppia, dopo la prima rosa si torna alla scelta per il secondo giocatore.
  if (selectedMode === 'duo' && picks.length === 1) {
    selectedFaction = null;
    $('btn-faction-confirm').disabled = true;
    renderFactionScreen({ playerNo: 2, taken: [factionId] });
    showScreen('faction');
    return;
  }

  startTournament();
}

/* ==================== torneo ==================== */

function startTournament() {
  const seed = draftSeed ?? randomSeed();
  const humans = picks.map((p) => p.factionId);

  const teams = {};
  for (const id of ALL_FACTION_IDS) {
    const humanIdx = humans.indexOf(id);
    teams[id] = humanIdx >= 0
      ? { factionId: id, roster: picks[humanIdx].roster, isPlayer: true, playerNo: humanIdx + 1 }
      : { factionId: id, roster: generateAiRoster(seed + hashId(id), id), isPlayer: false };
  }

  const schedule = buildSchedule(ALL_FACTION_IDS, seed);
  setState(newTournamentState({
    seed, factionId: humans[0], roster: picks[0].roster, presetId: selectedPreset,
    teams, schedule, mode: selectedMode, humans,
  }));
  goToTournament();
}

const hashId = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function goToTournament() {
  const state = getState();
  refreshStage(state);
  renderTournament(state, { onPlay: onPlayNext, onSimulateAll });
  showScreen('tournament');
}

/** Aggiorna la fase del torneo (girone → finali → concluso). */
function refreshStage(state) {
  if (state.stage === 'group' && isGroupComplete(state.schedule)) {
    const standings = computeStandings(state.schedule, Object.keys(state.teams));
    state.finals = buildFinals(standings);
    state.stage = 'finals';
  }
  if (state.stage === 'finals' && state.finals && isFinalsComplete(state.finals)) {
    state.stage = 'done';
  }
}

/* ==================== svolgimento delle tirate ==================== */

const teamCache = new Map();

function engineTeam(state, factionId) {
  const key = `${state.seed}:${factionId}`;
  if (!teamCache.has(key)) {
    teamCache.set(key, buildTeam(factionId, state.teams[factionId].roster));
  }
  return teamCache.get(key);
}

function fixtureSeed(state, fixture) {
  return (Number(state.seed) ^ hashId(fixture.id)) >>> 0;
}

/**
 * Risolve un incontro senza rendering, con lo stesso motore del match giocato.
 * Vale per qualsiasi incontro, comprese le tirate del giocatore: in quel caso
 * a chiamare è lo stile IA del suo quartiere, sulla sua rosa.
 */
function resolveFixture(state, fixture) {
  const result = simulateFixture({
    homeTeam: engineTeam(state, fixture.home),
    awayTeam: engineTeam(state, fixture.away),
    preset: getPreset(state),
    seed: fixtureSeed(state, fixture),
  });
  recordResult(fixture, result);
}

/* ---- chi è umano ---- */

const isHuman = (state, id) => state.humans.includes(id);
// Numero del giocatore (1 o 2) che chiama un quartiere umano.
const humanNoOf = (state, id) => state.humans.indexOf(id) + 1;
// Schema di tasti: a giocatore singolo tutti gli alias, in coppia lettere al
// primo e frecce al secondo.
function keysFor(state, id) {
  if (state.mode !== 'duo') return 'solo';
  return humanNoOf(state, id) === 2 ? 'p2' : 'p1';
}

/** Costruisce i controllori dei due lati e avvia la tirata giocata. */
function playFixture(state, fixture, homeHuman, awayHuman) {
  const controllers = [
    homeHuman
      ? { type: 'human', playerNo: humanNoOf(state, fixture.home), keys: keysFor(state, fixture.home) }
      : { type: 'ai' },
    awayHuman
      ? { type: 'human', playerNo: humanNoOf(state, fixture.away), keys: keysFor(state, fixture.away) }
      : { type: 'ai' },
  ];
  return playMatch({
    homeTeam: engineTeam(state, fixture.home),
    awayTeam: engineTeam(state, fixture.away),
    controllers,
    duo: state.mode === 'duo',
    preset: getPreset(state),
    seed: fixtureSeed(state, fixture),
    title: `${getFaction(fixture.home).name} – ${getFaction(fixture.away).name}`,
  });
}

async function onPlayNext() {
  const state = getState();

  if (state.stage === 'done') {
    backToStart();
    return;
  }

  const fixture = state.stage === 'finals'
    ? nextFinal(state.finals)
    : pendingHumanFixtureOfDay(state);

  if (!fixture) {
    // Nessuna partita di un umano: risolve il resto della giornata.
    resolveAiFixtures(state);
    mutate((s) => refreshStage(s));
    goToTournament();
    return;
  }

  $('btn-play-next').disabled = true;
  const homeHuman = isHuman(state, fixture.home);
  const awayHuman = isHuman(state, fixture.away);

  if (!homeHuman && !awayHuman) {
    // Finale fra sole IA: si risolve headless.
    resolveFixture(state, fixture);
  } else {
    showScreen('match');
    const result = await playFixture(state, fixture, homeHuman, awayHuman);
    recordResult(fixture, result);
  }

  // Completata la tirata, si chiude il resto del turno.
  resolveAiFixtures(state);
  mutate((s) => refreshStage(s));
  goToTournament();
}

/**
 * Porta il torneo alla conclusione senza scendere in campo: risolve tutte le
 * tirate rimaste, comprese quelle del giocatore, e assegna il podio.
 *
 * Le finali si costruiscono solo a girone chiuso, quindi il girone va risolto
 * per intero prima di sapere chi le disputa: `refreshStage` in mezzo non è
 * un dettaglio, è ciò che rende possibile la seconda metà.
 */
function resolveWholeTournament(state) {
  for (const day of state.schedule) {
    for (const f of day.fixtures) if (!f.played) resolveFixture(state, f);
  }
  refreshStage(state);

  if (state.finals) {
    for (const f of [state.finals.third, state.finals.first]) {
      if (!f.played) resolveFixture(state, f);
    }
  }
  refreshStage(state);
}

async function onSimulateAll() {
  const state = getState();
  if (state.stage === 'done') return;

  const restanti = allFixtures(state.schedule).filter((f) => !f.played).length
    + (state.finals ? [state.finals.third, state.finals.first].filter((f) => !f.played).length : 2);
  const ok = confirm(
    `Simulare le ${restanti} tirate che restano?\n\n`
    + 'Anche le tirate dei giocatori le chiamerà l’IA, sulle rose composte. '
    + 'Il torneo arriverà al podio e non sarà più giocabile.',
  );
  if (!ok) return;

  $('btn-play-next').disabled = true;
  $('btn-sim-all').disabled = true;
  mutate((s) => resolveWholeTournament(s));
  goToTournament();
}

/**
 * Prima tirata della giornata corrente che coinvolge un umano e non è ancora
 * disputata. In coppia una giornata può averne due (un umano ciascuna): si
 * restituisce la prima, l'altra tornerà al giro successivo.
 */
function pendingHumanFixtureOfDay(state) {
  const day = currentDay(state.schedule);
  if (!day) return null;
  return day.fixtures.find(
    (f) => !f.played && (isHuman(state, f.home) || isHuman(state, f.away)),
  ) ?? null;
}

/**
 * Risolve tutte le partite fra sole IA che precedono la prossima di un umano,
 * così la classifica resta allineata giornata per giornata.
 */
function resolveAiFixtures(state) {
  const aiOnly = (f) => !isHuman(state, f.home) && !isHuman(state, f.away);

  if (state.stage === 'finals' && state.finals) {
    for (const f of [state.finals.third, state.finals.first]) {
      if (!f.played && aiOnly(f)) resolveFixture(state, f);
    }
    return;
  }

  for (const day of state.schedule) {
    // Ci si ferma alla giornata in cui un umano deve ancora scendere in campo:
    // gli esiti delle giornate successive non vanno anticipati.
    const humanPending = day.fixtures.some(
      (f) => !f.played && (isHuman(state, f.home) || isHuman(state, f.away)),
    );
    if (humanPending) break;

    for (const f of day.fixtures) if (!f.played && aiOnly(f)) resolveFixture(state, f);
  }
}

/* ==================== avvio ==================== */

/** Ripulisce le scelte in corso e torna alla schermata del primo giocatore. */
function backToStart() {
  clearSave();
  teamCache.clear();
  selectedFaction = null;
  picks = [];
  draftSeed = null;
  $('btn-faction-confirm').disabled = true;
  renderFactionScreen();
  showScreen('faction');
}

$('btn-abandon').onclick = () => {
  if (!confirm('Abbandonare il torneo in corso? I progressi andranno persi.')) return;
  backToStart();
};

renderFactionScreen();
showScreen('faction');
