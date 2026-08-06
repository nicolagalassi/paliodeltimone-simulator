/**
 * Calendario, classifica e finali.
 *
 * 4 squadre => circle method: 3 giornate di andata + 3 di ritorno,
 * 2 incontri per giornata. Al termine, Finale 3°/4° e Finale 1°/2°.
 */

import { FACTIONS } from '../data/factions.js';
import { makeRng } from './rng.js';

export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;

/**
 * Round robin per un numero pari di squadre (algoritmo del cerchio).
 * @param {string[]} ids
 * @returns {Array<Array<{home:string, away:string}>>}
 */
function roundRobin(ids) {
  const teams = ids.slice();
  const n = teams.length;
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const home = teams[i];
      const away = teams[n - 1 - i];
      // Alterna il fattore campo per equilibrare andata e ritorno.
      pairs.push(r % 2 === 0 ? { home, away } : { home: away, away: home });
    }
    rounds.push(pairs);
    // Ruota tenendo fermo il primo elemento.
    teams.splice(1, 0, teams.pop());
  }
  return rounds;
}

/**
 * Costruisce il calendario completo andata + ritorno.
 * @param {string[]} factionIds
 * @param {number|string} seed
 */
export function buildSchedule(factionIds, seed) {
  const rng = makeRng(seed);
  const order = rng.shuffle(factionIds);
  const first = roundRobin(order);

  const days = [];
  first.forEach((pairs, i) => {
    days.push({
      day: i + 1,
      leg: 'andata',
      label: `Giornata ${i + 1} · Andata`,
      fixtures: pairs.map((p, j) => makeFixture(`a${i}-${j}`, p.home, p.away)),
    });
  });
  first.forEach((pairs, i) => {
    days.push({
      day: first.length + i + 1,
      leg: 'ritorno',
      label: `Giornata ${first.length + i + 1} · Ritorno`,
      // Nel ritorno si inverte il campo.
      fixtures: pairs.map((p, j) => makeFixture(`r${i}-${j}`, p.away, p.home)),
    });
  });

  return days;
}

function makeFixture(id, home, away) {
  return { id, home, away, played: false, result: null };
}

/**
 * @typedef {Object} MatchResult
 * @property {string|null} winner       id fazione vincente, null se pareggio
 * @property {'hold'|'proximity'|'draw'} reason
 * @property {number} holdHome          secondi max consecutivi in zona
 * @property {number} holdAway
 * @property {number} proximityHome     distanza angolare finale dalla zona (gradi)
 * @property {number} proximityAway
 */

export function recordResult(fixture, result) {
  fixture.played = true;
  fixture.result = result;
}

/** Tutte le partite di tutte le giornate, in ordine. */
export function allFixtures(schedule) {
  return schedule.flatMap((d) => d.fixtures);
}

export function isGroupComplete(schedule) {
  return allFixtures(schedule).every((f) => f.played);
}

/** Prima giornata con almeno una partita da giocare. */
export function currentDay(schedule) {
  return schedule.find((d) => d.fixtures.some((f) => !f.played)) ?? null;
}

/** Prossima partita del giocatore ancora da disputare. */
export function nextPlayerFixture(schedule, factionId) {
  const day = currentDay(schedule);
  if (!day) return null;
  return day.fixtures.find((f) => !f.played && (f.home === factionId || f.away === factionId)) ?? null;
}

/* ---------------- classifica ---------------- */

export function computeStandings(schedule, teamIds) {
  const rows = Object.fromEntries(
    teamIds.map((id) => [id, {
      factionId: id, played: 0, won: 0, drawn: 0, lost: 0,
      holdFor: 0, holdAgainst: 0, points: 0,
    }]),
  );

  const headToHead = {}; // "a|b" => punti di a contro b

  for (const f of allFixtures(schedule)) {
    if (!f.played || !f.result) continue;
    const { home, away, result } = f;
    const H = rows[home];
    const A = rows[away];
    if (!H || !A) continue;

    H.played++; A.played++;
    // Il "tempo in zona" fa da differenza reti: misura quanto si è stati vicini al palio.
    H.holdFor += result.holdHome;   H.holdAgainst += result.holdAway;
    A.holdFor += result.holdAway;   A.holdAgainst += result.holdHome;

    if (result.winner === home) {
      H.won++; A.lost++; H.points += WIN_POINTS;
      bump(headToHead, home, away, WIN_POINTS);
    } else if (result.winner === away) {
      A.won++; H.lost++; A.points += WIN_POINTS;
      bump(headToHead, away, home, WIN_POINTS);
    } else {
      H.drawn++; A.drawn++;
      H.points += DRAW_POINTS; A.points += DRAW_POINTS;
      bump(headToHead, home, away, DRAW_POINTS);
      bump(headToHead, away, home, DRAW_POINTS);
    }
  }

  const list = Object.values(rows);
  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const dh = (b.holdFor - b.holdAgainst) - (a.holdFor - a.holdAgainst);
    if (Math.abs(dh) > 1e-6) return dh;
    const h2h = (headToHead[`${b.factionId}|${a.factionId}`] ?? 0)
              - (headToHead[`${a.factionId}|${b.factionId}`] ?? 0);
    if (h2h !== 0) return h2h;
    if (Math.abs(b.holdFor - a.holdFor) > 1e-6) return b.holdFor - a.holdFor;
    // Ultimo criterio: ordine stabile e deterministico.
    return a.factionId.localeCompare(b.factionId);
  });

  list.forEach((row, i) => { row.position = i + 1; });
  return list;
}

function bump(map, a, b, pts) {
  const key = `${a}|${b}`;
  map[key] = (map[key] ?? 0) + pts;
}

/* ---------------- finali ---------------- */

export function buildFinals(standings) {
  const [first, second, third, fourth] = standings.map((r) => r.factionId);
  return {
    third: makeFixture('final-3', third, fourth),
    first: makeFixture('final-1', first, second),
  };
}

export function finalsFixtures(finals) {
  return finals ? [finals.third, finals.first] : [];
}

export function isFinalsComplete(finals) {
  return finalsFixtures(finals).every((f) => f.played);
}

/** Prossima finale da disputare (prima la 3°/4°). */
export function nextFinal(finals) {
  return finalsFixtures(finals).find((f) => !f.played) ?? null;
}

/** Podio definitivo, dai risultati delle due finali. */
export function computePodium(finals) {
  const rank = (fx, winSlot, loseSlot) => {
    const w = fx.result?.winner;
    // Il pareggio in finale non è ammesso: il motore forza sempre un vincitore.
    const winner = w ?? fx.home;
    const loser = winner === fx.home ? fx.away : fx.home;
    return { [winSlot]: winner, [loseSlot]: loser };
  };
  return {
    ...rank(finals.first, 1, 2),
    ...rank(finals.third, 3, 4),
  };
}

export const ALL_FACTION_IDS = FACTIONS.map((f) => f.id);
