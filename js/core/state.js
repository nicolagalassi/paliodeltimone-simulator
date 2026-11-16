/**
 * Stato globale unico + persistenza.
 * Ogni mutazione passa da una funzione di questo modulo: nessuna scrittura
 * sparsa nel resto dell'app, così il salvataggio resta sempre coerente.
 */

import { assignRolesByWeight } from './roster.js';

const SAVE_KEY = 'pdt.save.v2';

/**
 * I due formati. `duration` e `hold` valgono per la tirata in tempo reale;
 * `carte` per quella a carte, che si misura in battute da cinque secondi e
 * chiede meno secondi di tenuta: con chiamate da cinque secondi parcheggiare il
 * palo nell'arco è più difficile che dosandolo istante per istante.
 */
export const PRESETS = {
  rapida: {
    id: 'rapida', label: 'Breve', duration: 120, hold: 10,
    carte: { battute: 18, hold: 8 },
  },
  regolamentare: {
    id: 'regolamentare', label: 'Regolamentare', duration: 240, hold: 10,
    carte: { battute: 26, hold: 8 },
  },
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

export function newTournamentState({
  seed, factionId, roster, presetId, teams, schedule, mode = 'single', humans, tirata = 'carte',
}) {
  return {
    version: 3,
    seed,
    mode,                                   // 'single' | 'duo'
    tirata: tirata === 'tempo' ? 'tempo' : 'carte',   // come si chiama la tirata
    // Quartieri chiamati da un umano, in ordine di giocatore. `factionId` resta
    // il primo per compatibilità con i tanti punti che leggono "il mio quartiere".
    humans: humans ?? [factionId],
    factionId,
    presetId: presetId in PRESETS ? presetId : 'rapida',
    roster,
    teams,           // { [factionId]: { factionId, roster, isPlayer, playerNo } }
    schedule,        // array di giornate
    finals: null,    // creato al termine del girone
    stage: 'group',  // 'group' | 'finals' | 'done'
    createdAt: Date.now(),
  };
}

export const getPreset = (s = state) => PRESETS[s?.presetId] ?? PRESETS.rapida;

/** Battute e tenuta della tirata a carte nel formato del torneo. */
export const getCardPreset = (s = state) => getPreset(s).carte;

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

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.schedule) return null;
    // Si accettano i salvataggi dalla v2 in poi. Ai vecchi, nati prima della
    // modalità a due, si aggiungono i campi mancanti come torneo a giocatore
    // singolo, così un torneo lasciato a metà resta riprendibile.
    if (parsed.version !== 2 && parsed.version !== 3) return null;
    if (!parsed.mode) parsed.mode = 'single';
    if (!parsed.humans) parsed.humans = [parsed.factionId];
    // I tornei salvati prima delle carte si giocavano in tempo reale: restano così.
    if (!parsed.tirata) parsed.tirata = 'tempo';
    // Rose salvate prima delle posizioni: si assegna un ruolo per peso, così il
    // motore trova la leva e la formazione resta coerente.
    for (const id of Object.keys(parsed.teams ?? {})) {
      const roster = parsed.teams[id]?.roster;
      if (Array.isArray(roster) && roster.some((s) => !s.role)) assignRolesByWeight(roster);
    }
    if (Array.isArray(parsed.roster) && parsed.roster.some((s) => !s.role)) {
      assignRolesByWeight(parsed.roster);
    }
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
