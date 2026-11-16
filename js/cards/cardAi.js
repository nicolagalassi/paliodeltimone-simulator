/**
 * Il Chiamatore artificiale della tirata a carte.
 *
 * Non vede la carta dell'avversario: le carte si scoprono insieme. Quello che
 * fa è ciò che farebbe un chiamatore vero — prova a immaginare la battuta.
 * Per ogni sua carta gioca di nascosto la battuta contro ciascuna delle carte
 * che l'avversario potrebbe avere, pesate su due cose che può sapere davvero:
 *
 *   - il mazzo dell'avversario, che è la sua formazione e quindi è pubblico;
 *   - quello che l'avversario ha giocato finora. Chi chiama sempre la stessa
 *     carta viene letto, e punito.
 *
 * Poi sceglie, ma non sempre la carta migliore: un po' di imprevedibilità è
 * ciò che lo rende un avversario da leggere invece che un orologio da sfruttare.
 * Quanta, e con quali preferenze, dipende dallo stile del quartiere.
 */

import { cloneMatch } from '../match/engine.js';
import { FRENO, makePlan } from './cards.js';
import { runBattuta, evaluate } from './battuta.js';

/**
 * Carattere dei chiamatori. `temp` è l'imprevedibilità (più alta = scelte più
 * varie), `bias` una preferenza per certe carte, in punti di valutazione.
 */
const STYLES = {
  aggressivo:  { temp: 20, bias: { spallata: 10, spinta: 4, sotto: 3, freno: -8 } },
  calcolatore: { temp: 9,  bias: {} },
  agile:       { temp: 16, bias: { lampo: 9, sotto: 6, strappo: 2 } },
  metodico:    { temp: 13, bias: { spinta: 5, freno: 4, strappo: 2, spallata: -3 } },
};

/** Quanto pesano le abitudini osservate rispetto alla composizione del mazzo. */
const LEARN = 2.2;
/** Peso a priori del Freno, che l'avversario ha sempre in mano. */
const FRENO_PRIOR = 2.5;

/**
 * Una carta "media" per ogni tipo presente nel mazzo avversario: la forza
 * esatta di una sua Spallata non la si conosce finché non la gioca, ma si sa
 * più o meno quanto valgono le sue.
 */
function opponentModel(deck) {
  const byType = new Map();
  for (const c of deck) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c);
  }
  const model = [];
  for (const [type, cards] of byType) {
    const avg = (key) => {
      const vals = cards.map((c) => c[key]).filter((v) => typeof v === 'number');
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
    };
    model.push({
      type,
      prior: cards.length,
      card: {
        uid: `modello-${type}`, type,
        boost: avg('boost'), drain: avg('drain'), fast: avg('fast'),
        sure: cards.some((c) => c.sure),
      },
    });
  }
  model.push({ type: 'freno', prior: FRENO_PRIOR, card: FRENO });
  return model;
}

/** Chiave per non provare due volte la stessa carta (stesso tipo, stessa forza). */
const cardKey = (c) => `${c.type}:${(c.boost ?? 1).toFixed(2)}:${(c.fast ?? 1).toFixed(2)}`;

/**
 * @param {number} index   0 = squadra in casa, 1 = in trasferta
 * @param {string} style   chiave di STYLES
 * @param {Function} rng
 * @param {Array} oppDeck  il mazzo dell'avversario
 */
export function createCardAi(index, style, rng, oppDeck) {
  const cfg = STYLES[style] ?? STYLES.metodico;
  const model = opponentModel(oppDeck);
  const seen = {};
  let seenTotal = 0;

  /** Probabilità stimata di ciascuna carta avversaria. */
  function opponentOdds() {
    const w = model.map((o) => {
      const habit = (seen[o.type] ?? 0) / (seenTotal + 4);
      return o.prior * (1 + LEARN * habit * model.length);
    });
    const sum = w.reduce((a, b) => a + b, 0);
    return model.map((o, k) => ({ card: o.card, p: w[k] / sum }));
  }

  return {
    style,

    /** Registra la carta che l'avversario ha appena scoperto. */
    observe(type) {
      seen[type] = (seen[type] ?? 0) + 1;
      seenTotal++;
    },

    /**
     * Sceglie la carta da giocare fra quelle disponibili.
     * @param {object} m        stato del match (non viene toccato)
     * @param {Array} options   carte giocabili: la mano più il Freno
     * @param {{battute:number, battutaIndex:number}} ctx
     */
    choose(m, options, { battute, battutaIndex }) {
      const odds = opponentOdds();
      const fixed = () => 0.5;      // nelle prove il sotto riesce se è probabile

      const unique = [];
      const keys = new Set();
      for (const c of options) {
        const k = cardKey(c);
        if (!keys.has(k)) { keys.add(k); unique.push(c); }
      }

      const scored = unique.map((mine) => {
        let ev = 0;
        for (const { card: theirs, p } of odds) {
          const sim = cloneMatch(m, fixed);
          const pm = makePlan(mine);
          const pt = makePlan(theirs);
          runBattuta(sim, index === 0 ? pm : pt, index === 0 ? pt : pm, battute, battutaIndex);
          ev += p * evaluate(sim, index);
        }
        return { card: mine, score: ev + (cfg.bias[mine.type] ?? 0) };
      });

      // Scelta morbida: le carte migliori sono le più probabili, non le uniche.
      const best = Math.max(...scored.map((s) => s.score));
      const w = scored.map((s) => Math.exp((s.score - best) / cfg.temp));
      const sum = w.reduce((a, b) => a + b, 0);
      let r = rng() * sum;
      for (let k = 0; k < scored.length; k++) {
        r -= w[k];
        if (r <= 0) return scored[k].card;
      }
      return scored[scored.length - 1].card;
    },
  };
}
