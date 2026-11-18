/**
 * Gli imprevisti di battuta: ogni tanto una battuta ha una condizione che
 * cambia le regole per entrambe le squadre. Si annuncia prima di chiamare,
 * così entra nella scelta delle carte.
 *
 * Ognuno può toccare i modificatori della battuta (`mods`), l'energia
 * (`energy`, per squadra) e le carte pescate (`draw`).
 */

import { teamDistance } from '../match/engine.js';

/** Probabilità che una battuta (dalla seconda in poi) abbia un imprevisto. */
export const IMPREVISTO_CHANCE = 0.3;

export const IMPREVISTI = {
  fango: {
    name: 'Il fango',
    text: 'Ha piovuto: le spinte rendono il 30% in meno, le tirate il 20% in più.',
    mods: (m) => ({ ...m, push: m.push * 0.7, pull: m.pull * 1.2 }),
  },
  pubblico: {
    name: 'Il pubblico incita',
    text: 'La piazza spinge chi è indietro: +1⚡ alla squadra più lontana dalla zona.',
    energy: (match) => {
      const d = [0, 1].map((i) => teamDistance(match, i));
      if (Math.abs(d[0] - d[1]) < 1e-6) return [0, 0];
      return d[0] > d[1] ? [1, 0] : [0, 1];
    },
  },
  campane: {
    name: 'Le campane della Torre',
    text: 'Suona l’Orologio e tutti alzano la testa: ognuno pesca una carta in più.',
    draw: 1,
  },
  solleone: {
    name: 'Il solleone',
    text: 'Il caldo toglie il fiato: −1⚡ a entrambe le squadre.',
    energy: () => [-1, -1],
  },
  capitani: {
    name: 'Il richiamo dei capitani',
    text: 'I capitani urlano le chiamate: nessuna esce a metà in questa battuta.',
    mods: (m) => ({ ...m, noMisfire: true }),
  },
};

/** L'imprevisto di una battuta, o null. Il primo colpo della tirata è sempre pulito. */
export function rollImprevisto(rng, battutaIndex) {
  if (battutaIndex === 0 || rng() >= IMPREVISTO_CHANCE) return null;
  const ids = Object.keys(IMPREVISTI);
  return ids[Math.floor(rng() * ids.length)];
}
