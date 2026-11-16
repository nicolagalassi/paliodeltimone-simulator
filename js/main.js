/**
 * Bootstrap: scelta del quartiere → primo bonus → torneo → tirate.
 *
 * Il torneo è una run: tutte le squadre partono uguali, con lo stesso mazzo, e
 * crescono con i bonus guadagnati nella Zona Palio. Mazzo e bonus di ciascun
 * quartiere stanno nello stato del torneo (`state.run`) e si portano da una
 * tirata all'altra — anche quelli che le IA guadagnano fra loro.
 */

import { FACTIONS, getFaction } from './data/factions.js';
import { makeRng, randomSeed } from './core/rng.js';
import {
  getState, setState, mutate, newTournamentState, loadSave, clearSave, getCardPreset,
} from './core/state.js';
import {
  buildSchedule, ALL_FACTION_IDS, recordResult, currentDay, isGroupComplete,
  computeStandings, buildFinals, nextFinal, isFinalsComplete, allFixtures,
} from './core/tournament.js';
import { showScreen, el } from './ui/screens.js';
import { renderTournament } from './ui/calendarUI.js';
import { renderBonusChoice, deckList } from './ui/bonusUI.js';
import { buildTeam } from './match/match.js';
import { playCardMatch } from './cards/cardMatch.js';
import { simulateCardFixture } from './cards/cardSim.js';
import { BASE_DECK } from './cards/cards.js';
import {
  newLoadout, grantBonus, offerBonuses, aiPickBonus,
} from './cards/bonus.js';

const $ = (id) => document.getElementById(id);

let selectedFaction = null;
let selectedPreset = 'rapida';
let selectedMode = 'single';       // 'single' | 'duo'
let picks = [];                    // quartieri scelti dagli umani, in ordine di giocatore

/** Come chiama un quartiere quando lo si affronta. */
const STYLE_LABEL = {
  aggressivo: 'chiamatore aggressivo: spinge e carica',
  calcolatore: 'chiamatore calcolatore: gioca il colpo giusto',
  agile: 'chiamatore agile: passa sotto e rimescola',
  metodico: 'chiamatore metodico: tiene e frena',
};

/* ==================== schermata del quartiere ==================== */

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
  $('format-bar').hidden = !firstPick;

  for (const f of FACTIONS) {
    const card = el('button', 'faction-card');
    card.type = 'button';
    card.style.setProperty('--fc', f.color);
    card.dataset.id = f.id;

    const bonus = el('div', 'faction-bonus');
    bonus.append(el('strong', null, STYLE_LABEL[f.aiStyle] ?? ''), el('div', null, f.motto));
    card.append(
      el('div', 'faction-crest'),
      el('div', 'faction-name', f.name),
      el('div', 'faction-color', f.colorName),
      bonus,
    );

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
    const who = save.humans.map((id) => getFaction(id).name).join(' e ');
    resume.textContent = `Riprendi torneo · ${who}`;
    resume.onclick = () => { setState(save, { save: false }); goToTournament(); };
  }

  $('btn-faction-confirm').onclick = () => {
    if (selectedFaction) onFactionChosen(selectedFaction);
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

function onFactionChosen(factionId) {
  picks.push(factionId);

  // In coppia, dopo il primo quartiere si torna alla scelta per il secondo giocatore.
  if (selectedMode === 'duo' && picks.length === 1) {
    selectedFaction = null;
    $('btn-faction-confirm').disabled = true;
    renderFactionScreen({ playerNo: 2, taken: [factionId] });
    showScreen('faction');
    return;
  }
  startRun();
}

/* ==================== primo bonus ==================== */

/** Fa scegliere il primo bonus a un giocatore umano; risolve con l'id scelto. */
function chooseFirstBonus({ factionId, playerNo, loadout, rng }) {
  return new Promise((resolve) => {
    const faction = getFaction(factionId);
    document.documentElement.style.setProperty('--fc', faction.color);
    $('bonus-title').textContent = selectedMode === 'duo'
      ? `Giocatore ${playerNo} · ${faction.name}: il primo bonus`
      : `${faction.name}: il primo bonus`;
    $('deck-preview').replaceChildren(deckList(loadout.deck));
    renderBonusChoice($('bonus-grid'), offerBonuses(loadout, rng), resolve);
    showScreen('bonus');
  });
}

/**
 * Prepara la run: ogni quartiere ha il mazzo base; le IA scelgono subito il loro
 * primo bonus, gli umani lo scelgono a schermo, uno alla volta.
 */
async function startRun() {
  const seed = randomSeed();
  const rng = makeRng(seed ^ 0x5bd1e995);
  const run = {};
  for (const id of ALL_FACTION_IDS) {
    run[id] = newLoadout(BASE_DECK);
    if (!picks.includes(id)) {
      grantBonus(run[id], aiPickBonus(offerBonuses(run[id], rng), getFaction(id).aiStyle, rng));
    }
  }
  for (let k = 0; k < picks.length; k++) {
    const id = await chooseFirstBonus({ factionId: picks[k], playerNo: k + 1, loadout: run[picks[k]], rng });
    grantBonus(run[picks[k]], id);
  }
  startTournament(seed, run);
}

/* ==================== torneo ==================== */

function startTournament(seed, run) {
  const humans = picks.slice();
  const teams = {};
  for (const id of ALL_FACTION_IDS) {
    const humanIdx = humans.indexOf(id);
    teams[id] = { factionId: id, isPlayer: humanIdx >= 0, playerNo: humanIdx + 1 || null };
  }
  const schedule = buildSchedule(ALL_FACTION_IDS, seed);
  setState(newTournamentState({
    seed, presetId: selectedPreset, teams, schedule, mode: selectedMode, humans, run,
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

/** La squadra pronta per il motore: la stessa formazione per tutti. */
function engineTeam(factionId) {
  if (!teamCache.has(factionId)) teamCache.set(factionId, buildTeam(factionId));
  return teamCache.get(factionId);
}

function fixtureSeed(state, fixture) {
  return (Number(state.seed) ^ hashId(fixture.id)) >>> 0;
}

/**
 * Risolve un incontro senza disegnarlo, con le stesse regole di quello giocato:
 * le due IA chiamano con i loro mazzi e i loro bonus, e quelli che guadagnano
 * in zona restano a loro per il resto del torneo.
 */
function resolveFixture(state, fixture) {
  const result = simulateCardFixture({
    homeTeam: engineTeam(fixture.home),
    awayTeam: engineTeam(fixture.away),
    loadouts: [state.run[fixture.home], state.run[fixture.away]],
    ...getCardPreset(state),
    seed: fixtureSeed(state, fixture),
  });
  recordResult(fixture, result);
}

/* ---- chi è umano ---- */

const isHuman = (state, id) => state.humans.includes(id);
// Numero del giocatore (1 o 2) che chiama un quartiere umano.
const humanNoOf = (state, id) => state.humans.indexOf(id) + 1;

/** Costruisce i controllori dei due lati e avvia la tirata giocata. */
function playFixture(state, fixture, homeHuman, awayHuman) {
  const side = (id, human) => (human ? { type: 'human', playerNo: humanNoOf(state, id) } : { type: 'ai' });
  return playCardMatch({
    homeTeam: engineTeam(fixture.home),
    awayTeam: engineTeam(fixture.away),
    loadouts: [state.run[fixture.home], state.run[fixture.away]],
    controllers: [side(fixture.home, homeHuman), side(fixture.away, awayHuman)],
    duo: state.mode === 'duo',
    ...getCardPreset(state),
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
    // Finale fra sole IA: si risolve senza disegnarla.
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
 * tirate rimaste, comprese quelle dei giocatori, e assegna il podio.
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
    + 'Anche le tirate dei giocatori le chiamerà l’IA, con i loro mazzi e i loro bonus. '
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
