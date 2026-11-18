/**
 * Le carte della tirata.
 *
 * La tirata si gioca a battute di cinque secondi. A ogni battuta il Chiamatore
 * ha un'ENERGIA da spendere (5, più i bonus) e una mano di carte. Ogni carta
 * ha un costo in energia e una DURATA in secondi: se ne giocano quante si
 * vuole, in fila e nell'ordine scelto, finché bastano energia e tempo. Il
 * tempo che avanza è presa passiva: la squadra tiene ma non spinge.
 *
 * Le due squadre partono identiche, con lo stesso mazzo base. A distinguerle
 * sono le carte e gli effetti guadagnati durante il torneo (vedi bonus.js).
 *
 * Il Freno non sta nel mazzo: è sempre disponibile, una volta per battuta, non
 * costa nulla e fa rifiatare — un punto di energia in più alla battuta dopo.
 */

import { TUNING, normAngle, activeArm } from '../match/engine.js';

/** Secondi di tirata giocati da ogni battuta. */
export const BATTUTA_SECONDS = 5;
/** Carte pescate a ogni battuta (più i bonus). */
export const HAND_SIZE = 5;
/**
 * Energia di ogni battuta (più i bonus). Le carte base costano 1 e durano 1
 * secondo: con 4 energia si riempiono quattro secondi, e il quinto lo copre il
 * Freno, che è gratis ma frena invece di spingere. Ogni carta più forte o più
 * lunga obbliga quindi a rinunciare a qualcos'altro.
 *
 * Il valore viene dalle misure: con 5 energia se ne spendeva poco più di metà
 * e non finiva quasi mai — l'energia non decideva niente, decideva il tempo.
 * Con 4 finisce in circa una battuta su tre, e le scelte diventano vere.
 */
export const BASE_ENERGY = 4;

/**
 * I tipi di carta. `kind` è il gesto che la carta dà al motore; `cost` è
 * l'energia, `dur` i secondi di battuta che occupa. `boost`, `sure` e `fast`
 * sono i suoi modificatori.
 */
export const CARD_TYPES = {
  /* ---- mazzo base ---- */
  spinta: {
    name: 'Spinta', kind: 'push', cost: 1, dur: 1,
    text: 'Tutta la squadra avanti, spalle al palo.',
  },
  tirata: {
    name: 'Tirata', kind: 'pull', cost: 1, dur: 1,
    text: 'Il palo verso di sé, camminando all’indietro: uno strattone breve e forte.',
  },
  tenuta: {
    name: 'Tenuta', kind: 'hold', cost: 1, dur: 1, boost: 0.9,
    text: 'Si riporta il palo al centro dell’arco e lo si ferma.',
  },
  sotto: {
    name: 'Sotto', kind: 'sotto', cost: 1, dur: 2,
    text: 'Si passa sotto il palo e ci si rigira: la spinta cambia verso. Con la giostra lanciata può fallire.',
  },
  freno: {
    name: 'Freno', kind: 'brake', cost: 0, dur: 1,
    text: 'Ci si pianta: smorza la giostra e si rifiata. Una volta per battuta.',
  },

  /* ---- carte da guadagnare come bonus ----
   * Due strade: la POTENZA (Spallata, Strattone) costa molta energia per pochi
   * secondi, l'EFFICIENZA (Carica lunga, Àncora) dà più secondi per energia. */
  spallata: {
    name: 'Spallata', kind: 'push', cost: 2, dur: 1, boost: 1.6,
    text: 'Gli Esterni caricano a testa bassa: la spinta più forte che c’è.',
  },
  carica: {
    name: 'Carica lunga', kind: 'push', cost: 2, dur: 3, boost: 1.05,
    text: 'Una spinta lunga e tenuta, che non molla per tre secondi.',
  },
  strattone: {
    name: 'Strattone', kind: 'pull', cost: 2, dur: 1, boost: 1.5,
    text: 'Una tirata violenta e prolungata: si porta via il palo.',
  },
  ancora: {
    name: 'Àncora', kind: 'hold', cost: 2, dur: 3, boost: 1.1,
    text: 'I Mediani si piantano attorno al palo e non lo lasciano uscire dall’arco.',
  },
  lampo: {
    name: 'Passaggio lampo', kind: 'sotto', cost: 1, dur: 1, sure: true, fast: 0.55,
    text: 'Gli Interni guidano il passaggio: sotto sicuro e rapidissimo.',
  },
};

/** Il mazzo con cui partono tutte le squadre. */
export const BASE_DECK = [
  'spinta', 'spinta', 'spinta', 'spinta', 'spinta',
  'tirata', 'tirata',
  'tenuta', 'tenuta', 'tenuta',
  'sotto', 'sotto',
];

const isSotto = (card) => CARD_TYPES[card.type].kind === 'sotto';

let uidSeq = 0;
/** Una carta concreta, con un identificativo unico nella tirata. */
export const makeCard = (type) => ({ uid: `${type}-${++uidSeq}`, type });

/** Il Freno: sempre disponibile, non si pesca e non si consuma. */
export const FRENO = Object.freeze({ uid: 'freno', type: 'freno' });

/* ======================= modificatori della squadra ======================= */

/**
 * Modificatori che i bonus permanenti applicano alle carte di una squadra.
 * Senza bonus valgono tutti 1 (o falso): le carte rendono come scritto.
 */
export const NO_MODS = Object.freeze({
  push: 1, pull: 1, hold: 1, brake: 1,
  sottoSure: false, energy: 0, draw: 0, frenoEnergy: 1, noMisfire: false,
});

/** Forza effettiva di una carta per una squadra con i suoi modificatori. */
export function cardBoost(card, mods = NO_MODS) {
  const t = CARD_TYPES[card.type];
  return (t.boost ?? 1) * (mods[t.kind] ?? 1);
}

/* ============================ mano e mazzo ============================ */

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Mazzo, mano e scarti di una squadra durante la tirata. */
export function createHand(deckTypes, rng) {
  return { draw: shuffle(deckTypes.map(makeCard), rng), discard: [], hand: [] };
}

/** Aggiunge una carta nuova (un bonus) fra gli scarti: entra in gioco al rimescolo. */
export function addToHand(h, type) {
  h.discard.push(makeCard(type));
}

/** Si pesca fino a `size`; finito il mazzo si rimescolano gli scarti. */
export function drawHand(h, rng, size = HAND_SIZE) {
  while (h.hand.length < size) {
    if (!h.draw.length) {
      if (!h.discard.length) break;
      h.draw = shuffle(h.discard, rng);
      h.discard = [];
    }
    h.hand.push(h.draw.pop());
  }
  return h.hand;
}

/** A fine battuta la mano va tutta negli scarti, giocata o no. */
export function discardHand(h) {
  h.discard.push(...h.hand);
  h.hand = [];
}

/** Carte fra cui scegliere in questa battuta: la mano più il Freno. */
export const playable = (h) => [...h.hand, FRENO];

/* ============================== sequenze ============================== */

export const seqCost = (seq) => seq.reduce((a, c) => a + CARD_TYPES[c.type].cost, 0);
export const seqDur = (seq) => seq.reduce((a, c) => a + CARD_TYPES[c.type].dur, 0);

/**
 * La carta si può aggiungere in coda alla sequenza? Servono energia e tempo,
 * la carta non dev'essere già in fila, il Freno vale una volta e il sotto pure.
 * @returns {string|null} il motivo per cui non si può, o null se si può
 */
export function whyNot(seq, card, energy) {
  const t = CARD_TYPES[card.type];
  if (seq.some((c) => c.uid === card.uid)) return 'già in fila';
  if (seqCost(seq) + t.cost > energy) return 'energia insufficiente';
  if (seqDur(seq) + t.dur > BATTUTA_SECONDS + 1e-9) return 'non c’è più tempo nella battuta';
  if (isSotto(card) && seq.some(isSotto)) return 'un solo sotto per battuta';
  return null;
}

/** Energia che la sequenza lascia per la battuta dopo, grazie al Freno. */
export const seqCarry = (seq, mods = NO_MODS) => (seq.some((c) => c.type === 'freno') ? mods.frenoEnergy : 0);

/**
 * Probabilità che una chiamata esca eseguita male. È il Gioco di squadra:
 * una squadra affiatata esegue sempre, una slegata a volte segue a metà.
 */
export function misfireChance(team, mods = NO_MODS) {
  if (mods.noMisfire) return 0;
  return Math.max(0, Math.min(0.3, 0.6 * (0.72 - (team.discipline ?? 0.6))));
}

/** Quanto rende una chiamata eseguita male. */
export const MISFIRE_GAIN = 0.62;
/** Secondi di esitazione di un sotto chiamato male. */
export const MISFIRE_DELAY = 0.6;

/**
 * Il comando di una singola carta, passo per passo, mentre è la carta attiva.
 * Spinta, tirata e freno danno lo stesso comando per tutta la durata; la Tenuta
 * è un piccolo controllore; il sotto si chiama, si aspetta il passaggio e poi
 * si spinge nel nuovo verso per il tempo che resta.
 */
function cardPlan(card, mods, misfire, dt) {
  const t = CARD_TYPES[card.type];
  const k = misfire ? MISFIRE_GAIN : 1;
  const boost = cardBoost(card, mods) * k;

  if (t.kind === 'push') return () => ({ type: 'push', boost });
  if (t.kind === 'pull') return () => ({ type: 'pull', boost });
  if (t.kind === 'brake') return () => ({ type: 'brake', boost });

  if (t.kind === 'hold') {
    return (m, i) => {
      const off = normAngle(activeArm(m, i) - TUNING.ZONE_CENTER);
      const u = -(off + 2.2 * m.omega);
      if (Math.abs(u) < 0.03) return { type: 'brake', boost };
      return Math.sign(u) === m.rt[i].facing ? { type: 'push', boost } : { type: 'pull', boost };
    };
  }

  // sotto
  let elapsed = 0;
  let issued = false;
  let started = false;
  const delay = misfire ? MISFIRE_DELAY : 0;
  const cmd = {
    type: 'sotto',
    sure: !misfire && (!!t.sure || mods.sottoSure),
    fast: misfire ? 1 : (t.fast ?? 1),
  };
  return (m, i) => {
    elapsed += dt;
    const rt = m.rt[i];
    if (!started) {
      if (issued && rt.sottoTimer > 0) started = true;
      else if (rt.sottoTimer > 0 || elapsed < delay) return { type: 'idle' };
      else { issued = true; return cmd; }
    }
    return { type: 'push', boost: mods.push };
  };
}

/**
 * Il piano di una battuta: la sequenza di carte eseguita in fila, ognuna per
 * la sua durata. Finita la sequenza la squadra resta in presa passiva.
 * @param {Array} seq        le carte, nell'ordine in cui si giocano
 * @param {object} mods      modificatori della squadra
 * @param {boolean[]} [misfires]  quali carte escono eseguite male
 * @param {number} [dt]      passo del motore con cui verrà eseguito
 */
export function makeSequencePlan(seq, mods = NO_MODS, misfires = [], dt = TUNING.STEP) {
  const segs = [];
  let at = 0;
  seq.forEach((card, k) => {
    const dur = CARD_TYPES[card.type].dur;
    segs.push({ card, start: at, end: at + dur, misfire: !!misfires[k] });
    at += dur;
  });

  let t = 0;
  let idx = -1;
  let sub = null;
  return (m, i) => {
    while (idx + 1 < segs.length && t >= segs[idx + 1].start - 1e-9) {
      idx++;
      sub = cardPlan(segs[idx].card, mods, segs[idx].misfire, dt);
    }
    const active = idx >= 0 && t < segs[idx].end - 1e-9;
    t += dt;
    return active ? sub(m, i) : { type: 'idle' };
  };
}

/* ============================ letture del campo ============================ */

/**
 * La carta avvicina il proprio palo all'arco, con l'orientamento attuale?
 * È l'indicazione "→ palio" sulle carte.
 */
export function cardTowardGoal(m, i, card) {
  const off = normAngle(activeArm(m, i) - TUNING.ZONE_CENTER);
  if (Math.abs(off) <= TUNING.ZONE_HALF) return CARD_TYPES[card.type].kind === 'hold';
  const pushToward = m.rt[i].facing === -Math.sign(off);
  const kind = CARD_TYPES[card.type].kind;
  if (kind === 'push') return pushToward;
  if (kind === 'pull') return !pushToward;
  if (kind === 'sotto') return !pushToward;
  if (kind === 'hold') return true;
  return false;
}

/** Riga breve degli effetti di una carta per una squadra. */
export function cardEffect(card, mods = NO_MODS) {
  const t = CARD_TYPES[card.type];
  // La Tenuta ha una resa base sotto 1 per costruzione (vedi CARD_TYPES): su
  // una carta di partenza un "−10%" confonderebbe, si mostra solo l'effetto
  // dei bonus.
  const shown = t.kind === 'hold' ? (mods.hold ?? 1) * ((t.boost ?? 1) / 0.9) : cardBoost(card, mods);
  const pct = Math.round((shown - 1) * 100);
  const forza = pct === 0 ? '' : ` ${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
  switch (t.kind) {
    case 'push': return `spinta${forza}`;
    case 'pull': return `tirata${forza}`;
    case 'hold': return `tiene il palo${forza}`;
    case 'sotto': return (t.sure || mods.sottoSure) ? 'sotto sicuro' : 'sotto, poi spinta';
    case 'brake': return `+${mods.frenoEnergy}⚡ alla prossima`;
    default: return '';
  }
}
