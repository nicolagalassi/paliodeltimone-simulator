/**
 * Stato globale unico + persistenza.
 * Ogni mutazione passa da una funzione di questo modulo: nessuna scrittura
 * sparsa nel resto dell'app, così il salvataggio resta sempre coerente.
 */

const SAVE_KEY = 'pdt.save.v2';
const VERSION = 4;

/**
 * I due formati della tirata: quante battute da cinque secondi, e quanti
 * secondi consecutivi in zona servono per vincerla.
 */
export const PRESETS = {
  rapida: { id: 'rapida', label: 'Breve', battute: 18, hold: 8 },
  regolamentare: { id: 'regolamentare', label: 'Regolamentare', battute: 26, hold: 8 },
};

/** @type {any} */
let state = null;

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

export const getState = () => state;

export function setState(next, { save = true } = {}) {
  state = next;
  if (save) persist();
  emit();
  return state;
}

/** Applica una mutazione in-place e notifica. */
export function mutate(fn, { save = true } = {}) {
  fn(state);
  if (save) persist();
  emit();
  return state;
}

/**
 * @param {object} cfg
 * @param {Object<string, {deck:string[], bonuses:string[]}>} cfg.run
 *   mazzo e bonus di ogni quartiere: crescono lungo il torneo
 */
export function newTournamentState({
  seed, presetId, teams, schedule, mode = 'single', humans, run,
}) {
  return {
    version: VERSION,
    seed,
    mode,                                   // 'single' | 'duo'
    // Quartieri chiamati da un umano, in ordine di giocatore. `factionId` è il
    // primo, per i tanti punti che leggono "il mio quartiere".
    humans,
    factionId: humans[0],
    presetId: presetId in PRESETS ? presetId : 'rapida',
    teams,           // { [factionId]: { factionId, isPlayer, playerNo } }
    run,             // { [factionId]: { deck, bonuses } }
    schedule,        // array di giornate
    finals: null,    // creato al termine del girone
    stage: 'group',  // 'group' | 'finals' | 'done'
    createdAt: Date.now(),
  };
}

export const getPreset = (s = state) => PRESETS[s?.presetId] ?? PRESETS.rapida;

/** Battute e tenuta della tirata nel formato del torneo. */
export const getCardPreset = (s = state) => {
  const p = getPreset(s);
  return { battute: p.battute, hold: p.hold };
};

/* ---------------- persistenza ---------------- */

export function persist() {
  if (!state) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (err) {
    // Quota piena o storage disabilitato: il gioco resta giocabile in memoria.
    console.warn('Salvataggio non riuscito:', err);
  }
}

/**
 * Si riprendono solo i tornei della versione attuale. Quelli precedenti erano
 * fatti di rose scelte a mano e di tirate in tempo reale, che non esistono
 * più: non c'è un modo onesto di convertirli in mazzi e bonus.
 */
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION || !parsed.schedule || !parsed.run) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasSave() {
  return loadSave() !== null;
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch { /* ignora */ }
  state = null;
  emit();
}
