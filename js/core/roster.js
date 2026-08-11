/**
 * Generazione dei tiratori e regole della formazione.
 *
 * Ogni squadra schiera sei tiratori su due bracci opposti del timone. Ogni
 * braccio è fatto di tre posizioni, dal perno verso l'esterno:
 *
 *   INTERNO  — vicino al perno: leva corta, il più leggero e agile.
 *   MEDIANO  — in mezzo al braccio: peso e leva intermedi.
 *   ESTERNO  — all'estremità: la leva più lunga, e quindi il più pesante.
 *
 * Il ruolo NON è una scelta libera: è la fascia di peso del tiratore. Il draft
 * lo sfrutta per semplificare la composizione — invece di bilanciare a mano un
 * budget di peso, si sceglie due tiratori per ciascuna posizione, e il peso
 * della squadra viene da sé. La leva della posizione entra poi nella tirata
 * (vedi `engine.js`): la Forza di un Esterno pesa sulla coppia più di quella di
 * un Interno, ed è ciò che dà un senso tattico a chi si mette dove.
 */

import { makeRng } from './rng.js';
import { FIRST_NAMES, LAST_NAMES, NICKNAMES } from '../data/names.js';
import { STATS, FACTION_BONUS, getFaction } from '../data/factions.js';

export const ROSTER_SIZE = 6;
export const PER_ROLE = 2;              // due tiratori per posizione: un palo per lato
export const CANDIDATES_PER_ROLE = 5;   // quanti se ne offrono per posizione nel draft

export const MIN_WEIGHT = 60;
export const MAX_WEIGHT = 115;

// Regola fissa del Palio: la formazione non può superare i 540 kg complessivi.
// Le fasce di peso rendono il tetto sempre raggiungibile (una formazione di soli
// leggeri pesa meno di 540), ma non gratuito: prendere l'Esterno più pesante
// costringe a un compagno più leggero altrove.
export const WEIGHT_CAP = 540;

/**
 * Le tre posizioni sul braccio, dall'esterno verso il perno. `leverage` è il
 * braccio di leva con cui la posizione agisce sulla coppia del timone; la media
 * pesata sui sei tiratori (2 per ruolo) vale 1, così la scala della coppia
 * resta quella di prima e a cambiare è solo *dove* conviene la Forza.
 */
export const ROLES = [
  {
    id: 'esterno', label: 'Esterno', short: 'EST', leverage: 1.30,
    weight: [98, 115],
    blurb: 'All’estremità del braccio: la leva più lunga, il peso maggiore.',
  },
  {
    id: 'mediano', label: 'Mediano', short: 'MED', leverage: 1.00,
    weight: [80, 97],
    blurb: 'In mezzo al braccio: peso e leva intermedi.',
  },
  {
    id: 'interno', label: 'Interno', short: 'INT', leverage: 0.70,
    weight: [60, 79],
    blurb: 'Vicino al perno: leva corta, il più leggero e agile.',
  },
];

export const ROLE_IDS = ROLES.map((r) => r.id);
export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));
export const leverageOf = (roleId) => ROLE_BY_ID[roleId]?.leverage ?? 1;

const clampStat = (v) => Math.max(5, Math.min(99, Math.round(v)));

/**
 * @param {Function} rng
 * @param {number} id
 * @param {string} roleId
 * @returns {{id:number,role:string,name:string,weight:number,stats:Object}}
 */
function makeShooter(rng, id, roleId) {
  const role = ROLE_BY_ID[roleId];
  const [lo, hi] = role.weight;
  const weight = rng.int(lo, hi);
  // 0 = il più leggero del range assoluto, 1 = il più pesante: la correlazione
  // peso→statistiche resta sull'intera scala, così gli Esterni nascono forti e
  // gli Interni agili, coerentemente con la loro fascia.
  const heavy = (weight - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT);

  const base = () => 50 + rng.noise() * 70;

  const stats = {
    forza:      clampStat(base() + (heavy - 0.5) * 46),
    agilita:    clampStat(base() - (heavy - 0.5) * 46),
    squadra:    clampStat(base()),
    resistenza: clampStat(base() - (heavy - 0.5) * 20),
  };

  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  const name = rng() < 0.18 ? `${first} "${rng.pick(NICKNAMES)}" ${last}` : `${first} ${last}`;

  return { id, role: roleId, name, weight, stats };
}

/**
 * Pool di draft diviso per posizione: per ciascun ruolo un elenco di candidati
 * fra cui sceglierne `PER_ROLE`. Gli id sono unici su tutta la formazione.
 * @returns {{esterno:Array, mediano:Array, interno:Array}}
 */
export function generateFormationPool(seed, per = CANDIDATES_PER_ROLE) {
  const rng = makeRng(seed);
  const pool = {};
  let id = 0;
  for (const roleId of ROLE_IDS) {
    pool[roleId] = Array.from({ length: per }, () => makeShooter(rng, id++, roleId));
  }
  return pool;
}

function avgStats(stats) {
  return STATS.reduce((sum, k) => sum + stats[k], 0) / STATS.length;
}

/** Valore di un tiratore per una fazione: quanto rende, non quanto per chilo. */
function value(shooter, faction) {
  return avgStats(shooter.stats) + shooter.stats[faction.bonusStat] * 0.45;
}

/** I migliori `n` candidati di una lista per una fazione. */
export function bestForRole(candidates, factionId, n = PER_ROLE, exclude = []) {
  const faction = getFaction(factionId);
  return candidates
    .filter((s) => !exclude.some((e) => e.id === s.id))
    .sort((a, b) => value(b, faction) - value(a, faction))
    .slice(0, n);
}

export const totalWeight = (roster) => roster.reduce((sum, s) => sum + s.weight, 0);

/**
 * Peso minimo per completare la formazione dai candidati ancora liberi: per
 * ogni posizione si sommano i tiratori più leggeri quanti ne servono. Serve a
 * non lasciar scegliere un tiratore che renderebbe impossibile stare sotto il
 * tetto — come i posti a cinque della vecchia rosa, ma diviso per posizione.
 */
function reserveWeight(pool, picks, addingRoleId) {
  let reserve = 0;
  for (const roleId of ROLE_IDS) {
    const chosen = picks[roleId] ?? [];
    let need = PER_ROLE - chosen.length;
    if (roleId === addingRoleId) need -= 1;              // lo slot che si sta occupando
    if (need <= 0) continue;
    const weights = pool[roleId]
      .filter((s) => !chosen.some((c) => c.id === s.id))
      .map((s) => s.weight)
      .sort((a, b) => a - b);
    if (weights.length < need) return Infinity;          // impossibile completare
    for (let i = 0; i < need; i++) reserve += weights[i];
  }
  return reserve;
}

/**
 * Il tiratore può entrare nella posizione senza rendere impossibile completare
 * la formazione entro i 540 kg?
 */
export function canAddToFormation(pool, picks, shooter) {
  const chosen = picks[shooter.role] ?? [];
  if (chosen.length >= PER_ROLE) return false;
  if (chosen.some((s) => s.id === shooter.id)) return false;
  const already = ROLE_IDS.reduce((sum, r) => sum + totalWeight(picks[r] ?? []), 0);
  const reserve = reserveWeight(pool, picks, shooter.role);
  return already + shooter.weight + reserve <= WEIGHT_CAP;
}

/**
 * Rosa completa per un quartiere IA: i due migliori per posizione, poi — se si
 * sfora il tetto — si alleggerisce sostituendo chi costa più valore per chilo
 * risparmiato, finché si rientra nei 540 kg. Deterministica.
 */
export function generateAiRoster(seed, factionId) {
  const faction = getFaction(factionId);
  const pool = generateFormationPool(seed, CANDIDATES_PER_ROLE + 3);
  const chosen = {};
  for (const roleId of ROLE_IDS) chosen[roleId] = bestForRole(pool[roleId], factionId, PER_ROLE);

  const total = () => ROLE_IDS.reduce((sum, r) => sum + totalWeight(chosen[r]), 0);

  let guard = 0;
  while (total() > WEIGHT_CAP && guard++ < 50) {
    let best = null;   // { roleId, outIdx, cand, costPerKg }
    for (const roleId of ROLE_IDS) {
      const others = pool[roleId].filter((s) => !chosen[roleId].some((c) => c.id === s.id));
      chosen[roleId].forEach((out, outIdx) => {
        for (const cand of others) {
          const saved = out.weight - cand.weight;
          if (saved <= 0) continue;
          const lost = Math.max(0, value(out, faction) - value(cand, faction));
          const costPerKg = lost / saved;
          if (!best || costPerKg < best.costPerKg) best = { roleId, outIdx, cand, costPerKg };
        }
      });
    }
    if (!best) break;                                    // niente di più leggero: si esce
    chosen[best.roleId][best.outIdx] = best.cand;
  }

  return ROLE_IDS.flatMap((r) => chosen[r]);
}

/** Quanti tiratori sono stati scelti per ciascuna posizione. */
export function roleCounts(roster) {
  const counts = Object.fromEntries(ROLE_IDS.map((r) => [r, 0]));
  for (const s of roster) if (s.role in counts) counts[s.role]++;
  return counts;
}

/**
 * La formazione è valida se ha esattamente `PER_ROLE` tiratori per posizione e
 * non supera il tetto dei 540 kg.
 */
export function validateFormation(roster) {
  const counts = roleCounts(roster);
  const kg = totalWeight(roster);
  const rolesOk = roster.length === ROSTER_SIZE && ROLE_IDS.every((r) => counts[r] === PER_ROLE);
  return { ok: rolesOk && kg <= WEIGHT_CAP, counts, kg, overWeight: kg > WEIGHT_CAP };
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
 * Assegna una posizione ai tiratori di una rosa che non ne hanno una — i vecchi
 * salvataggi, nati prima dei ruoli. Si ordina per peso: i due più pesanti fanno
 * gli Esterni, i due centrali i Mediani, i due più leggeri gli Interni.
 */
export function assignRolesByWeight(roster) {
  const byWeight = roster.slice().sort((a, b) => b.weight - a.weight);
  byWeight.forEach((s, i) => { s.role = ROLE_IDS[Math.floor(i / PER_ROLE)] ?? 'mediano'; });
  return roster;
}
