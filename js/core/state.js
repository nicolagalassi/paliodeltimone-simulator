/**
 * Stato globale unico + persistenza.
 * Ogni mutazione passa da una funzione di questo modulo: nessuna scrittura
 * sparsa nel resto dell'app, così il salvataggio resta sempre coerente.
 */

const SAVE_KEY = 'pdt.save.v2';
/** Versione del salvataggio del Cammino (vedi run/cammino.js). */
const CAMMINO_VERSION = 5;

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
 * Si riprendono solo i cammini della versione attuale. I tornei salvati dalle
 * versioni precedenti, che avevano anche la modalità Torneo, si ignorano.
 */
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.kind !== 'cammino' || parsed.version !== CAMMINO_VERSION || !parsed.map) return null;
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
