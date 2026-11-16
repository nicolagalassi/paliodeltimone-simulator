/**
 * La battuta: cinque secondi di tirata giocati dal motore fisico con le due
 * carte scoperte. Qui ci sono l'esecuzione (tutta d'un fiato per la
 * simulazione, a pezzi per l'animazione) e la lettura della posizione con cui
 * il Chiamatore artificiale giudica le sue carte.
 */

import {
  TUNING, step, normAngle, distanceToZone, activeArm, endOnTime,
} from '../match/engine.js';
import { BATTUTA_SECONDS } from './cards.js';

const DEG = Math.PI / 180;

/** Passi di motore in una battuta. */
export const BATTUTA_STEPS = Math.round(BATTUTA_SECONDS / TUNING.STEP);

/**
 * Gioca una battuta intera senza disegnarla.
 * Se era l'ultima, chiude la tirata allo scadere.
 */
export function runBattuta(m, planA, planB, battute = Infinity, index = 0) {
  for (let n = 0; n < BATTUTA_STEPS && !m.finished; n++) {
    step(m, TUNING.STEP, planA(m, 0), planB(m, 1));
  }
  if (index + 1 >= battute) endOnTime(m);
}

/**
 * La stessa battuta, ma a pezzi: `advance(dt)` consuma secondi reali e
 * restituisce true quando la battuta è finita. Serve all'animazione, che la
 * mostra al ritmo dei fotogrammi.
 */
export function createBattutaRunner(m, planA, planB, { battute = Infinity, index = 0 } = {}) {
  let done = 0;
  let acc = 0;
  return {
    advance(dt) {
      acc += dt;
      while (acc >= TUNING.STEP && done < BATTUTA_STEPS && !m.finished) {
        step(m, TUNING.STEP, planA(m, 0), planB(m, 1));
        acc -= TUNING.STEP;
        done++;
      }
      const over = done >= BATTUTA_STEPS || m.finished;
      if (over && index + 1 >= battute) endOnTime(m);
      return over;
    },
    get progress() { return done / BATTUTA_STEPS; },
  };
}

/** Distanza dall'arco del braccio più vicino della squadra k, con il timone a theta. */
function distAt(theta, k) {
  const a = theta + (k === 1 ? Math.PI / 2 : 0);
  return Math.min(distanceToZone(a), distanceToZone(a + Math.PI));
}

/**
 * La spinta della squadra k porta il suo braccio verso l'arco? +1 sì, -1 no,
 * 0 se è già dentro. Dopo la battuta conta come ci si trova girati.
 */
function facingScore(m, k) {
  const off = normAngle(activeArm(m, k) - TUNING.ZONE_CENTER);
  if (Math.abs(off) <= TUNING.ZONE_HALF) return 0;
  return m.rt[k].facing === -Math.sign(off) ? 1 : -1;
}

/**
 * Quanto è buona la posizione per la squadra i. Più è alta, meglio sta.
 *
 * Contano, in quest'ordine: chi ha già vinto, la tenuta in corso, la distanza
 * dall'arco (adesso e fra un paio di secondi, se il timone continua a girare
 * così), l'orientamento per la battuta dopo e il fiato. Verso la fine della
 * tirata la distanza pesa di più, perché allo scadere decide lei.
 */
export function evaluate(m, i) {
  if (m.finished) {
    const w = m.outcome?.winnerIndex;
    return w === i ? 1e4 : w == null ? 0 : -1e4;
  }
  const j = 1 - i;
  const rt = m.rt[i];
  const rf = m.rt[j];
  const target = m.preset.hold;

  const holdTerm = ((rt.hold - rf.hold) / target) * 420;

  const ahead = m.theta + Math.max(-1, Math.min(1, m.omega)) * 1.6;
  const distNow = (distAt(m.theta, j) - distAt(m.theta, i)) / DEG;
  const distSoon = (distAt(ahead, j) - distAt(ahead, i)) / DEG;
  const timeLeft = m.preset.duration - m.time;
  const late = timeLeft < 2 * BATTUTA_SECONDS ? 2.2 : 1;
  const distTerm = (distNow + 0.6 * distSoon) * 3 * late;

  const faceTerm = (facingScore(m, i) - facingScore(m, j)) * 12;
  const stamTerm = (rt.stamina - rf.stamina) * 28;

  return holdTerm + distTerm + faceTerm + stamTerm;
}
