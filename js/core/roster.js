/**
 * Generazione dei tiratori e regole della rosa.
 *
 * Peso e statistiche sono correlati: un tiratore pesante tende ad avere più
 * Forza e meno Agilità. È questa correlazione a rendere il tetto di 540 kg
 * una scelta tattica (rosa pesante che spinge vs rosa leggera che inverte)
 * anziché un semplice vincolo aritmetico.
 */

import { makeRng } from './rng.js';
import { FIRST_NAMES, LAST_NAMES, NICKNAMES } from '../data/names.js';
import { STATS, FACTION_BONUS, getFaction } from '../data/factions.js';

export const WEIGHT_CAP = 540;
export const ROSTER_SIZE = 6;
export const POOL_SIZE = 18;

export const MIN_WEIGHT = 60;
export const MAX_WEIGHT = 115;

const clampStat = (v) => Math.max(5, Math.min(99, Math.round(v)));

/**
 * @param {Function} rng
 * @param {number} id
 * @returns {{id:number,name:string,weight:number,stats:Object}}
 */
function makeShooter(rng, id) {
  const weight = rng.int(MIN_WEIGHT, MAX_WEIGHT);
  // 0 = il più leggero del range, 1 = il più pesante.
  const heavy = (weight - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT);

  // Base 50 ± rumore, poi spostata dal peso nelle due statistiche fisiche.
  const base = () => 50 + rng.noise() * 70;

  const stats = {
    forza:      clampStat(base() + (heavy - 0.5) * 46),
    agilita:    clampStat(base() - (heavy - 0.5) * 46),
    squadra:    clampStat(base()),
    // I pesanti reggono un po' meno la lunga, ma molto meno di quanto perdano
    // in agilità: il peso resta una scelta, non una condanna.
    resistenza: clampStat(base() - (heavy - 0.5) * 20),
  };

  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const name = rng() < 0.18 ? `${first} "${rng.pick(NICKNAMES)}" ${last}` : `${first} ${last}`;

  return { id, name, weight, stats };
}

/** Pool da cui il giocatore pesca la rosa. */
export function generatePool(seed, size = POOL_SIZE) {
  const rng = makeRng(seed);
  return Array.from({ length: size }, (_, i) => makeShooter(rng, i));
}

/**
 * Rosa completa per un quartiere IA: genera un pool e ne estrae 6 sotto il tetto,
 * privilegiando il rating utile alla fazione. Deterministica dal seed.
 */
export function generateAiRoster(seed, factionId) {
  return autoFill(generatePool(seed, POOL_SIZE + 6), factionId);
}

function avgStats(stats) {
  return STATS.reduce((sum, k) => sum + stats[k], 0) / STATS.length;
}

/**
 * Valore assoluto di un tiratore per una fazione: conta quanto rende, non
 * quanto rende per chilo. Il tetto dei 540 kg resta così un vincolo reale
 * (una rosa di soli colossi non entra) invece di un incentivo ai pesi piuma.
 */
function value(shooter, faction) {
  // Il peso entra come pregio e non solo come costo: sui bracci del timone fa
  // leva. Senza questo termine i quartieri che premiano l'agilità comporrebbero
  // rose leggerissime, sprecando budget e perdendo più in spinta di quanto
  // guadagnino in destrezza.
  return avgStats(shooter.stats) + shooter.stats[faction.bonusStat] * 0.45 + shooter.weight * 0.20;
}

export const totalWeight = (roster) => roster.reduce((sum, s) => sum + s.weight, 0);

export function validateRoster(roster) {
  const kg = totalWeight(roster);
  return {
    kg,
    ok: roster.length === ROSTER_SIZE && kg <= WEIGHT_CAP,
    overWeight: kg > WEIGHT_CAP,
    remaining: WEIGHT_CAP - kg,
  };
}

/**
 * Peso minimo necessario per coprire `slots` posti con i tiratori ancora
 * disponibili. Usare MIN_WEIGHT come stima porta fuori strada: il pool concreto
 * può non contenere nessun peso piuma, e la rosa si incastrerebbe a cinque.
 */
function reserveWeight(slots, pool, roster, excludeId) {
  if (slots <= 0) return 0;
  if (!pool) return slots * MIN_WEIGHT;
  const available = pool
    .filter((s) => s.id !== excludeId && !roster.some((r) => r.id === s.id))
    .map((s) => s.weight)
    .sort((a, b) => a - b);
  if (available.length < slots) return Infinity;   // impossibile completare
  let sum = 0;
  for (let i = 0; i < slots; i++) sum += available[i];
  return sum;
}

/**
 * Può ancora entrare in rosa senza rendere impossibile completarla?
 * Passando `pool` la verifica usa i pesi realmente disponibili.
 */
export function canAdd(roster, shooter, pool = null) {
  if (roster.length >= ROSTER_SIZE) return false;
  if (roster.some((s) => s.id === shooter.id)) return false;
  const slotsAfter = ROSTER_SIZE - roster.length - 1;
  const reserve = reserveWeight(slotsAfter, pool, roster, shooter.id);
  return totalWeight(roster) + shooter.weight + reserve <= WEIGHT_CAP;
}

/** Statistiche medie della rosa, con il bonus di fazione già applicato. */
export function teamStats(roster, factionId) {
  const faction = getFaction(factionId);
  const out = {};
  for (const key of STATS) {
    const avg = roster.length
      ? roster.reduce((sum, s) => sum + s.stats[key], 0) / roster.length
      : 0;
    out[key] = key === faction.bonusStat ? avg * FACTION_BONUS : avg;
  }
  out.weight = totalWeight(roster);
  out.avgWeight = roster.length ? out.weight / roster.length : 0;
  return out;
}

/**
 * Riempimento automatico: massimizza il valore complessivo restando sotto il
 * tetto. Greedy sul valore assoluto, poi una passata di scambi che sostituisce
 * un titolare con un candidato migliore quando il budget residuo lo consente.
 */
export function autoFill(pool, factionId, current = []) {
  const faction = getFaction(factionId);
  const roster = current.slice();
  const candidates = pool
    .filter((s) => !roster.some((r) => r.id === s.id))
    .sort((a, b) => value(b, faction) - value(a, faction));

  for (const s of candidates) {
    if (roster.length >= ROSTER_SIZE) break;
    if (canAdd(roster, s, pool)) roster.push(s);
  }

  // Passata di miglioramento: prova a scambiare i più deboli con chi era stato
  // escluso solo per ragioni di peso al momento della scelta.
  for (let pass = 0; pass < 2; pass++) {
    for (const s of candidates) {
      if (roster.some((r) => r.id === s.id)) continue;
      let worstIdx = -1;
      let worstVal = Infinity;
      for (let i = 0; i < roster.length; i++) {
        const v = value(roster[i], faction);
        if (v < worstVal) { worstVal = v; worstIdx = i; }
      }
      if (worstIdx < 0 || value(s, faction) <= worstVal) continue;

      const without = roster.filter((_, i) => i !== worstIdx);
      if (canAdd(without, s, pool)) roster[worstIdx] = s;
    }
  }
  return roster;
}
