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

/* ==================== schermata fazione ==================== */

function renderFactionScreen() {
  const grid = $('faction-grid');
  grid.replaceChildren();

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

    card.addEventListener('click', () => {
      selectedFaction = f.id;
      for (const c of grid.children) c.classList.toggle('is-selected', c.dataset.id === f.id);
      $('btn-faction-confirm').disabled = false;
      document.documentElement.style.setProperty('--fc', f.color);
    });
    grid.append(card);
  }

  for (const btn of $('preset-options').querySelectorAll('.preset-btn')) {
    btn.addEventListener('click', () => {
      selectedPreset = btn.dataset.preset;
      for (const b of $('preset-options').children) {
        b.classList.toggle('is-active', b === btn);
      }
    });
  }

  const resume = $('btn-continue-save');
  const save = loadSave();
  resume.hidden = !save;
  if (save) {
    resume.textContent = `Riprendi torneo · ${getFaction(save.factionId).name}`;
    resume.onclick = () => { setState(save, { save: false }); goToTournament(); };
  }

  $('btn-faction-confirm').onclick = () => {
    if (selectedFaction) startDraft(selectedFaction);
  };
}

const bonusLabel = (stat) => STAT_LABEL[stat] ?? stat;

/* ==================== draft ==================== */

let draftSeed = null;

function startDraft(factionId) {
  draftSeed = randomSeed();
  const pool = generatePool(draftSeed);
  mountRoster({
    pool,
    factionId,
    onConfirm: (roster) => startTournament(factionId, roster),
  });
  showScreen('roster');
}

/* ==================== torneo ==================== */

function startTournament(factionId, roster) {
  const seed = draftSeed ?? randomSeed();

  const teams = {};
  for (const id of ALL_FACTION_IDS) {
    teams[id] = id === factionId
      ? { factionId: id, roster, isPlayer: true }
      : { factionId: id, roster: generateAiRoster(seed + hashId(id), id), isPlayer: false };
  }

  const schedule = buildSchedule(ALL_FACTION_IDS, seed);
  setState(newTournamentState({
    seed, factionId, roster, presetId: selectedPreset, teams, schedule,
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

async function onPlayNext() {
  const state = getState();

  if (state.stage === 'done') {
    clearSave();
    selectedFaction = null;
    $('btn-faction-confirm').disabled = true;
    renderFactionScreen();
    showScreen('faction');
    return;
  }

  const fixture = state.stage === 'finals'
    ? nextFinal(state.finals)
    : pendingPlayerFixtureOfDay(state);

  if (!fixture) {
    // Nessuna partita del giocatore: risolve il resto della giornata.
    resolveAiFixtures(state);
    mutate((s) => refreshStage(s));
    goToTournament();
    return;
  }

  $('btn-play-next').disabled = true;
  const playerIsHome = fixture.home === state.factionId;

  if (!playerIsHome && fixture.away !== state.factionId) {
    resolveFixture(state, fixture);
  } else {
    showScreen('match');
    const result = await playMatch({
      homeTeam: engineTeam(state, fixture.home),
      awayTeam: engineTeam(state, fixture.away),
      playerIndex: playerIsHome ? 0 : 1,
      preset: getPreset(state),
      seed: fixtureSeed(state, fixture),
      title: `${getFaction(fixture.home).name} – ${getFaction(fixture.away).name}`,
    });
    recordResult(fixture, result);
  }

  // Completata la partita del giocatore, si chiude il resto del turno.
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
    + 'Anche le tue le chiamerà l’IA, sulla rosa che hai composto. '
    + 'Il torneo arriverà al podio e non sarà più giocabile.',
  );
  if (!ok) return;

  $('btn-play-next').disabled = true;
  $('btn-sim-all').disabled = true;
  mutate((s) => resolveWholeTournament(s));
  goToTournament();
}

/** Partita del giocatore nella giornata corrente, se non ancora disputata. */
function pendingPlayerFixtureOfDay(state) {
  const day = currentDay(state.schedule);
  if (!day) return null;
  return day.fixtures.find(
    (f) => !f.played && (f.home === state.factionId || f.away === state.factionId),
  ) ?? null;
}

/**
 * Risolve tutte le partite fra sole IA che precedono la prossima del giocatore,
 * così la classifica resta allineata giornata per giornata.
 */
function resolveAiFixtures(state) {
  if (state.stage === 'finals' && state.finals) {
    for (const f of [state.finals.third, state.finals.first]) {
      if (!f.played && f.home !== state.factionId && f.away !== state.factionId) {
        resolveFixture(state, f);
      }
    }
    return;
  }

  for (const day of state.schedule) {
    // Ci si ferma alla giornata in cui il giocatore deve ancora scendere in campo:
    // gli esiti delle giornate successive non vanno anticipati.
    const playerPending = day.fixtures.some(
      (f) => !f.played && (f.home === state.factionId || f.away === state.factionId),
    );
    if (playerPending) break;

    for (const f of day.fixtures) {
      if (!f.played && f.home !== state.factionId && f.away !== state.factionId) {
        resolveFixture(state, f);
      }
    }
  }
}

/* ==================== avvio ==================== */

$('btn-abandon').onclick = () => {
  if (!confirm('Abbandonare il torneo in corso? I progressi andranno persi.')) return;
  clearSave();
  teamCache.clear();
  selectedFaction = null;
  $('btn-faction-confirm').disabled = true;
  renderFactionScreen();
  showScreen('faction');
};

renderFactionScreen();
showScreen('faction');
