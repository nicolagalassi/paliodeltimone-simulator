/**
 * Il Chiamatore artificiale della tirata a carte.
 *
 * Non vede la sequenza dell'avversario: le chiamate si scoprono insieme. Fa
 * quello che farebbe un chiamatore vero, cioè immagina la battuta:
 *
 *   1. mette in fila le sequenze che può giocare con la sua mano, la sua
 *      energia e i cinque secondi della battuta;
 *   2. le prova contro giocate verosimili dell'avversario: pesca a caso alcune
 *      mani dal suo mazzo, che è pubblico, e con la sua energia, che si conta,
 *      ne ricava le sequenze che potrebbe chiamare;
 *   3. pesa quelle giocate su come l'avversario ha giocato finora: chi chiama
 *      sempre la stessa cosa viene letto.
 *
 * Un modello di comodo ("quattro Spinte", "solo Tenuta") faceva giocare il
 * Chiamatore contro fantasmi, e contro un avversario vero non valeva più del
 * caso. Le mani pescate dal mazzo sono ciò che l'avversario ha davvero.
 *
 * Poi sceglie, ma non sempre la sequenza migliore: un po' di imprevedibilità è
 * ciò che lo rende un avversario da leggere invece che un orologio da sfruttare.
 * Quanta, e con quali preferenze, dipende dallo stile del quartiere.
 */

import { cloneMatch } from '../match/engine.js';
import {
  CARD_TYPES, FRENO, HAND_SIZE, whyNot, makeSequencePlan, seqCarry, NO_MODS,
} from './cards.js';
import { runBattuta, evaluate } from './battuta.js';

/**
 * Passo largo per le prove: cinque volte più veloce del motore vero, e alle
 * misure sceglie bene quanto un passo più fine.
 */
const LOOK_DT = 1 / 12;
/** Quante sequenze si provano al massimo. */
const MAX_CANDIDATES = 45;
/** Quanto pesano le abitudini osservate. */
const LEARN = 2.0;
/** Mani avversarie immaginate a ogni scelta. */
const SAMPLES = 5;
/** Valore di un punto di energia messo da parte per la battuta dopo. */
const CARRY_VALUE = 7;

/**
 * Carattere dei chiamatori. `temp` è l'imprevedibilità (più alta = scelte più
 * varie), `bias` una preferenza per certi gesti, in punti di valutazione.
 */
const STYLES = {
  aggressivo:  { temp: 18, bias: { push: 6, pull: 2, brake: -6 } },
  calcolatore: { temp: 8,  bias: {} },
  agile:       { temp: 14, bias: { sotto: 6, pull: 3 } },
  metodico:    { temp: 11, bias: { hold: 5, brake: 3 } },
};

const kindOf = (c) => CARD_TYPES[c.type].kind;

/** Tutte le permutazioni di una lista corta. */
function permutations(list) {
  if (list.length <= 1) return [list];
  const out = [];
  list.forEach((x, k) => {
    for (const rest of permutations([...list.slice(0, k), ...list.slice(k + 1)])) out.push([x, ...rest]);
  });
  return out;
}

const KIND_RANK = { brake: 0, sotto: 1, pull: 2, push: 3, hold: 4 };

/**
 * Gli ordini da provare per una combinazione di carte, raccolte in blocchi
 * dello stesso tipo. Con pochi blocchi si provano tutti gli ordini; con molti
 * quelli che contano: l'ordine naturale dei gesti, il suo rovescio, e il sotto
 * o il freno spostati in testa e in coda — sono loro a cambiare la battuta.
 */
function blockOrders(blocks) {
  if (blocks.length <= 3) return permutations(blocks);
  const rank = (b) => KIND_RANK[kindOf(b[0])];
  const base = blocks.slice().sort((x, y) => rank(x) - rank(y));
  const orders = [base, base.slice().reverse()];
  for (const special of base.filter((b) => ['sotto', 'brake'].includes(kindOf(b[0])))) {
    const others = base.filter((b) => b !== special);
    orders.push([special, ...others], [...others, special]);
  }
  return orders;
}

/**
 * Tutte le sequenze giocabili, senza doppioni: due Spinte uguali in mano danno
 * la stessa sequenza, qualunque delle due si giochi.
 *
 * Si parte dalle COMBINAZIONI (quante carte di ciascun tipo) e solo dopo si
 * scelgono gli ordini. Una ricerca in profondità con un tetto finiva per
 * esplorare quasi soltanto le sequenze che cominciano con la prima carta in
 * mano, e il Chiamatore non vedeva metà delle sue giocate.
 */
export function enumerateSequences(options, energy, max = MAX_CANDIDATES) {
  const groups = new Map();
  for (const c of options) {
    if (!groups.has(c.type)) groups.set(c.type, []);
    groups.get(c.type).push(c);
  }
  const types = [...groups.keys()];
  const counts = new Array(types.length).fill(0);
  const combos = [];
  (function rec(k) {
    if (k === types.length) { combos.push(counts.slice()); return; }
    for (let n = 0; n <= groups.get(types[k]).length; n++) { counts[k] = n; rec(k + 1); }
    counts[k] = 0;
  }(0));

  const out = [];
  const seen = new Set();
  for (const combo of combos) {
    const blocks = [];
    combo.forEach((n, k) => { if (n) blocks.push(groups.get(types[k]).slice(0, n)); });
    for (const order of blockOrders(blocks)) {
      const seq = [];
      let valid = true;
      for (const c of order.flat()) {
        if (whyNot(seq, c, energy)) { valid = false; break; }
        seq.push(c);
      }
      if (!valid) continue;
      const key = seq.map((x) => x.type).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(seq);
    }
  }
  // Se sono troppe si tengono per prime quelle che sfruttano di più la battuta.
  if (out.length > max) {
    const fill = (q) => q.reduce((a, c) => a + CARD_TYPES[c.type].dur, 0);
    out.sort((x, y) => fill(y) - fill(x));
    out.length = max;
  }
  return out;
}

let synth = 0;
const card = (type) => ({ uid: `ipotesi-${type}-${++synth}`, type });

/** Il gesto che occupa più tempo in una sequenza. */
function mainKind(seq) {
  const time = {};
  for (const c of seq) time[kindOf(c)] = (time[kindOf(c)] ?? 0) + CARD_TYPES[c.type].dur;
  return Object.keys(time).sort((a, b) => time[b] - time[a])[0] ?? 'brake';
}

/**
 * Giocate verosimili dell'avversario: si pescano a caso alcune mani dal suo
 * mazzo e per ciascuna si mette in fila una sequenza piena, in ordine casuale.
 * È ciò che può davvero avere in mano, non un modello di comodo.
 */
function sampledPlays(deckTypes, energy, rng, n) {
  const plays = [];
  for (let k = 0; k < n; k++) {
    const pool = deckTypes.slice();
    const hand = [];
    for (let j = 0; j < HAND_SIZE && pool.length; j++) hand.push(card(pool.splice(Math.floor(rng() * pool.length), 1)[0]));
    hand.push(FRENO);
    const seq = [];
    const order = hand.map((c) => ({ c, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.c);
    for (const c of order) if (!whyNot(seq, c, energy)) seq.push(c);
    plays.push({ kind: mainKind(seq), seq });
  }
  return plays;
}

/**
 * @param {number} index   0 = squadra in casa, 1 = in trasferta
 * @param {string} style   chiave di STYLES
 * @param {Function} rng
 */
export function createCardAi(index, style, rng, opts = {}) {
  const cfg = { ...(STYLES[style] ?? STYLES.metodico), ...opts };
  const carryValue = opts.carry ?? CARRY_VALUE;
  const habit = { push: 0, hold: 0, sotto: 0, pull: 0, brake: 0 };
  let habitTotal = 0;

  return {
    style,

    /** Registra la sequenza che l'avversario ha appena scoperto. */
    observe(seq) {
      if (!seq.length) return;
      // Conta il gesto che ha occupato più tempo nella battuta.
      const time = {};
      for (const c of seq) time[kindOf(c)] = (time[kindOf(c)] ?? 0) + CARD_TYPES[c.type].dur;
      const main = Object.keys(time).sort((a, b) => time[b] - time[a])[0];
      habit[main] += 1;
      habitTotal += 1;
    },

    /**
     * Sceglie la sequenza da giocare.
     * @param {object} m          stato del match (non viene toccato)
     * @param {object} ctx
     * @param {Array} ctx.options       carte giocabili (mano più Freno)
     * @param {number} ctx.energy       energia di questa battuta
     * @param {object} ctx.mods         modificatori propri
     * @param {Array} ctx.oppDeck       mazzo dell'avversario (tipi)
     * @param {number} ctx.oppEnergy    energia dell'avversario
     * @param {object} ctx.oppMods      modificatori dell'avversario
     * @param {number} ctx.battute
     * @param {number} ctx.battutaIndex
     */
    choose(m, {
      options, energy, mods = NO_MODS, oppDeck, oppEnergy, oppMods = NO_MODS, battute, battutaIndex,
    }) {
      const plays = sampledPlays(oppDeck, oppEnergy, rng, cfg.samples ?? SAMPLES);
      // Le abitudini osservate pesano le giocate che somigliano a quelle già viste.
      const w = plays.map((p) => 1 + LEARN * 5 * (habit[p.kind] / (habitTotal + 4)));
      const wsum = w.reduce((a, b) => a + b, 0) || 1;
      const fixed = () => 0.5;      // nelle prove il sotto riesce se è probabile

      const candidates = enumerateSequences(options, energy, cfg.maxCand ?? MAX_CANDIDATES);
      const dt = cfg.lookDt ?? LOOK_DT;
      const scored = candidates.map((seq) => {
        let ev = 0;
        plays.forEach((p, k) => {
          const sim = cloneMatch(m, fixed);
          const mine = makeSequencePlan(seq, mods, [], dt);
          const theirs = makeSequencePlan(p.seq, oppMods, [], dt);
          runBattuta(sim, index === 0 ? mine : theirs, index === 0 ? theirs : mine,
            battute, battutaIndex, dt);
          ev += (w[k] / wsum) * evaluate(sim, index);
        });
        let bias = 0;
        for (const c of seq) bias += (cfg.bias[kindOf(c)] ?? 0) * CARD_TYPES[c.type].dur / 2;
        return { seq, score: ev + bias + seqCarry(seq, mods) * carryValue };
      });

      // Scelta morbida: le sequenze migliori sono le più probabili, non le uniche.
      const best = Math.max(...scored.map((s) => s.score));
      const pw = scored.map((s) => Math.exp((s.score - best) / cfg.temp));
      const sum = pw.reduce((a, b) => a + b, 0);
      let r = rng() * sum;
      for (let k = 0; k < scored.length; k++) {
        r -= pw[k];
        if (r <= 0) return scored[k].seq;
      }
      return scored[scored.length - 1].seq;
    },
  };
}
