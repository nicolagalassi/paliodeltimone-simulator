/**
 * I bonus della run.
 *
 * Il torneo è una run: prima di cominciare ogni squadra sceglie un bonus, e poi
 * ne guadagna uno ogni BONUS_EVERY secondi passati nella Zona Palio — anche in
 * una tirata persa. I bonus restano per tutto il torneo. Sono di due tipi:
 *
 *   CARTA  — una carta nuova entra nel mazzo (Spallata, Àncora…);
 *   EFFETTO — un vantaggio permanente (più energia, più carte, spinta più forte…).
 *
 * L'IA guadagna i suoi con la stessa regola e li sceglie secondo il carattere
 * del suo quartiere.
 */

import { CARD_TYPES, NO_MODS } from './cards.js';

/** Secondi in zona (accumulati, non consecutivi) per guadagnare un bonus. */
export const BONUS_EVERY = 4;
/**
 * Bonus al massimo per tirata. Senza tetto una squadra ne prendeva più di tre a
 * tirata e a metà torneo il catalogo era esaurito: le scelte smettevano di
 * essere scelte. Con due, una run ne raccoglie una quindicina.
 */
export const MAX_BONUS_PER_TIRATA = 2;

/**
 * Il catalogo. `max` è quante volte si può prendere lo stesso bonus.
 * Gli effetti agiscono attraverso `apply`, che modifica i modificatori di squadra.
 */
export const BONUSES = {
  /* ---- carte ---- */
  spallata: { kind: 'card', card: 'spallata', max: 3 },
  carica: { kind: 'card', card: 'carica', max: 3 },
  strattone: { kind: 'card', card: 'strattone', max: 3 },
  ancora: { kind: 'card', card: 'ancora', max: 3 },
  lampo: { kind: 'card', card: 'lampo', max: 3 },

  /* ---- effetti permanenti ---- */
  fiato: {
    kind: 'effect', max: 2, name: 'Fiato lungo',
    text: '+1 energia a ogni battuta.',
    apply: (m) => { m.energy += 1; },
  },
  occhio: {
    kind: 'effect', max: 2, name: 'Occhio del chiamatore',
    text: 'Peschi una carta in più a ogni battuta.',
    apply: (m) => { m.draw += 1; },
  },
  esterni: {
    kind: 'effect', max: 3, name: 'Esterni d’acciaio',
    text: 'Tutte le spinte +15%.',
    apply: (m) => { m.push *= 1.15; },
  },
  braccia: {
    kind: 'effect', max: 3, name: 'Braccia lunghe',
    text: 'Tutte le tirate +20%.',
    apply: (m) => { m.pull *= 1.2; },
  },
  mediani: {
    kind: 'effect', max: 3, name: 'Mediani di ferro',
    text: 'Tenuta e Àncora +20%.',
    apply: (m) => { m.hold *= 1.2; },
  },
  interni: {
    kind: 'effect', max: 1, name: 'Interni svelti',
    text: 'Ogni sotto riesce, anche con la giostra lanciata.',
    apply: (m) => { m.sottoSure = true; },
  },
  piede: {
    kind: 'effect', max: 1, name: 'Piede piantato',
    text: 'Il Freno fa recuperare 2 energia invece di 1, e frena il doppio.',
    apply: (m) => { m.frenoEnergy = 2; m.brake *= 2; },
  },
  disciplina: {
    kind: 'effect', max: 1, name: 'Disciplina ferrea',
    text: 'Nessuna chiamata esce più eseguita a metà.',
    apply: (m) => { m.noMisfire = true; },
  },
};

/** Nome e descrizione di un bonus, anche per le carte. */
export function bonusInfo(id) {
  const b = BONUSES[id];
  if (b.kind === 'card') {
    const t = CARD_TYPES[b.card];
    return { name: t.name, text: t.text, card: b.card, cost: t.cost, dur: t.dur, kind: 'card' };
  }
  return { name: b.name, text: b.text, kind: 'effect' };
}

/** Quante volte la squadra ha già preso ciascun bonus. */
export function countBonuses(loadout) {
  const n = {};
  for (const id of loadout.bonuses) n[id] = (n[id] ?? 0) + 1;
  return n;
}

/**
 * Lo stato di una squadra nella run: il mazzo e i bonus presi.
 * Il mazzo parte dal base e cresce con i bonus-carta.
 */
export function newLoadout(baseDeck) {
  return { deck: baseDeck.slice(), bonuses: [] };
}

/** Applica un bonus allo stato della squadra (il mazzo cresce, l'effetto si annota). */
export function grantBonus(loadout, id) {
  loadout.bonuses.push(id);
  const b = BONUSES[id];
  if (b.kind === 'card') loadout.deck.push(b.card);
  return loadout;
}

/** I modificatori di squadra dati dagli effetti permanenti. */
export function modsOf(loadout) {
  const m = { ...NO_MODS };
  for (const id of loadout.bonuses) BONUSES[id].apply?.(m);
  return m;
}

/**
 * Tre bonus a scelta, diversi fra loro e non esauriti. Si mescolano carte ed
 * effetti: almeno una carta e almeno un effetto quando possibile.
 */
export function offerBonuses(loadout, rng, n = 3) {
  const owned = countBonuses(loadout);
  const avail = Object.keys(BONUSES).filter((id) => (owned[id] ?? 0) < BONUSES[id].max);
  const pick = (pool) => pool.splice(Math.floor(rng() * pool.length), 1)[0];
  const cards = avail.filter((id) => BONUSES[id].kind === 'card');
  const effects = avail.filter((id) => BONUSES[id].kind === 'effect');
  const out = [];
  if (cards.length) out.push(pick(cards));
  if (effects.length) out.push(pick(effects));
  const rest = [...cards, ...effects];
  while (out.length < n && rest.length) out.push(pick(rest));
  return out;
}

/* Preferenze dei quattro caratteri: quanto piace ciascun bonus (1 = neutro). */
const TASTE = {
  aggressivo: { spallata: 3, esterni: 3, carica: 2, fiato: 1.5, strattone: 1.5 },
  calcolatore: { fiato: 3, occhio: 3, disciplina: 2, ancora: 1.5, piede: 1.5 },
  agile: { lampo: 3, interni: 3, strattone: 2, braccia: 2, occhio: 1.5 },
  metodico: { ancora: 3, mediani: 3, piede: 2, disciplina: 2, carica: 1.5 },
};

/** La scelta dell'IA fra i bonus offerti: secondo il gusto, con un po' di caso. */
export function aiPickBonus(offers, style, rng) {
  const taste = TASTE[style] ?? {};
  const w = offers.map((id) => (taste[id] ?? 1) * (0.6 + 0.8 * rng()));
  return offers[w.indexOf(Math.max(...w))];
}
