/**
 * Le carte della tirata.
 *
 * La tirata si gioca a battute di cinque secondi. A ogni battuta il Chiamatore
 * ha un'ENERGIA da spendere (4, più i bonus) e una mano di carte. Ogni carta
 * ha un costo in energia e una DURATA in secondi: se ne giocano quante si
 * vuole, in fila e nell'ordine scelto, finché bastano energia e tempo. Il
 * tempo che avanza è presa passiva: la squadra tiene ma non spinge.
 *
 * Le due squadre partono identiche, con lo stesso mazzo base. A distinguerle
 * sono le carte e gli effetti guadagnati lungo il cammino (vedi bonus.js).
 *
 * Il Freno non sta nel mazzo: è sempre disponibile, una volta per battuta, non
 * costa nulla e fa rifiatare — un punto di energia in più alla battuta dopo.
 */

import {
  TUNING, normAngle, activeArm, commandDirection,
} from '../match/engine.js';

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

  /* ---- carte di risposta ----
   * Rendono solo se si indovina che cosa fa l'avversario in quel secondo: si
   * giocano leggendolo, non alla cieca. `react` dice come rispondono (vedi
   * resolveReactions). */
  muro: {
    name: 'Muro', kind: 'react', react: 'muro', cost: 1, dur: 1, boost: 1.5,
    text: 'Se l’avversario spinge o tira in quel secondo, la squadra gli fa muro contro (+50%). Altrimenti resta in presa.',
  },
  contropiede: {
    name: 'Contropiede', kind: 'react', react: 'contropiede', cost: 1, dur: 1, boost: 1.8,
    text: 'Se l’avversario frena, sta in presa o passa sotto, spinta +80%. Se invece spinge o tira, la spinta rende poco.',
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
  finta: {
    name: 'Finta', kind: 'react', react: 'finta', cost: 1, dur: 1, boost: 1,
    text: 'Si molla di colpo: se l’avversario spinge o tira in quel secondo, la sua forza va a vuoto (−70%) e la squadra tiene. Altrimenti, presa.',
  },
};

/**
 * Le combo: certe carte rendono di più se vengono subito dopo altre. Si
 * leggono sulla linea del tempo mentre si compone la sequenza.
 *   Ondata        — la terza spinta di fila (e le seguenti): +40%
 *   Rovescio      — una spinta subito dopo un sotto: +30%
 *   Strappo doppio — una tirata subito dopo un'altra: +30%
 *   Presa ferrea  — una tenuta subito dopo un'altra: +25%
 *   Rimessa       — un Contropiede subito dopo un Muro: +30%
 */
export const COMBOS = {
  ondata: { name: 'Ondata', mult: 1.4 },
  rovescio: { name: 'Rovescio', mult: 1.3 },
  strappo: { name: 'Strappo doppio', mult: 1.3 },
  ferrea: { name: 'Presa ferrea', mult: 1.25 },
  rimessa: { name: 'Rimessa', mult: 1.3 },
};

/** Per ogni carta della sequenza, la combo che la potenzia (o null). */
export function comboOf(seq) {
  const kinds = seq.map((c) => CARD_TYPES[c.type].kind);
  return seq.map((c, k) => {
    const kind = kinds[k];
    const prev = kinds[k - 1];
    if (kind === 'push' && prev === 'push' && kinds[k - 2] === 'push') return 'ondata';
    if (kind === 'push' && prev === 'sotto') return 'rovescio';
    if (kind === 'pull' && prev === 'pull') return 'strappo';
    if (kind === 'hold' && prev === 'hold') return 'ferrea';
    if (c.type === 'contropiede' && seq[k - 1]?.type === 'muro') return 'rimessa';
    return null;
  });
}

/** Il mazzo con cui partono tutte le squadre. */
export const BASE_DECK = [
  'spinta', 'spinta', 'spinta', 'spinta',
  'tirata', 'tirata',
  'tenuta', 'tenuta',
  'sotto', 'sotto',
  'muro', 'contropiede',
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
  push: 1, pull: 1, hold: 1, brake: 1, react: 1,
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
function cardPlan(card, mods, misfire, dt, combo = 1) {
  const t = CARD_TYPES[card.type];
  const k = misfire ? MISFIRE_GAIN : 1;
  const boost = cardBoost(card, mods) * k * combo;

  // Le risposte non decidono da sole: lo fa resolveReactions, guardando il
  // comando dell'avversario nello stesso istante.
  if (t.kind === 'react') return () => ({ type: 'react', react: t.react, boost });
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
  const combos = comboOf(seq);
  let at = 0;
  seq.forEach((card, k) => {
    const dur = CARD_TYPES[card.type].dur;
    const combo = combos[k] ? COMBOS[combos[k]].mult : 1;
    segs.push({
      card, start: at, end: at + dur, misfire: !!misfires[k], combo,
    });
    at += dur;
  });

  let t = 0;
  let idx = -1;
  let sub = null;
  return (m, i) => {
    while (idx + 1 < segs.length && t >= segs[idx + 1].start - 1e-9) {
      idx++;
      sub = cardPlan(segs[idx].card, mods, segs[idx].misfire, dt, segs[idx].combo);
    }
    const active = idx >= 0 && t < segs[idx].end - 1e-9;
    t += dt;
    return active ? sub(m, i) : { type: 'idle' };
  };
}

/**
 * Risolve le carte di risposta di un istante. Ciascuna guarda il comando
 * dell'avversario nello stesso passo (una risposta contro una risposta vale
 * come presa) e diventa un comando vero:
 *   Muro         — se l'altro spinge o tira, coppia contro la sua, +50%;
 *                  altrimenti presa;
 *   Contropiede  — se l'altro è fermo (presa, freno, sotto), spinta +80%;
 *                  altrimenti una spinta debole;
 *   Finta        — se l'altro spinge o tira, la sua forza va a vuoto (−70%) e
 *                  la squadra si pianta; altrimenti presa.
 * Annota in `rt.react` se la risposta ha colto nel segno, per mostrarlo.
 */
export function resolveReactions(m, a, b) {
  const cmds = [a ?? { type: 'idle' }, b ?? { type: 'idle' }];
  if (cmds[0].type !== 'react' && cmds[1].type !== 'react') {
    m.rt[0].react = null;
    m.rt[1].react = null;
    return cmds;
  }
  const out = cmds.slice();
  for (let i = 0; i < 2; i++) {
    const c = cmds[i];
    const rt = m.rt[i];
    if (c.type !== 'react') { rt.react = null; continue; }
    const opp = cmds[1 - i].type === 'react' ? { type: 'idle' } : cmds[1 - i];
    const rtO = m.rt[1 - i];
    const oppDir = rtO.sottoTimer > 0 ? 0 : commandDirection(opp.type, rtO.facing);
    let hit = false;
    if (c.react === 'muro') {
      hit = oppDir !== 0;
      out[i] = hit
        ? { type: commandDirection('push', rt.facing) === -oppDir ? 'push' : 'pull', boost: c.boost }
        : { type: 'idle' };
    } else if (c.react === 'contropiede') {
      hit = oppDir === 0;
      out[i] = { type: 'push', boost: hit ? c.boost : c.boost * 0.35 };
    } else if (c.react === 'finta') {
      hit = oppDir !== 0;
      if (hit) out[1 - i] = { ...out[1 - i], boost: (out[1 - i].boost ?? 1) * 0.3 };
      out[i] = hit ? { type: 'brake', boost: c.boost } : { type: 'idle' };
    }
    rt.react = hit ? 'hit' : 'miss';
  }
  return out;
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
  if (card.type === 'contropiede') return pushToward;
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
    case 'react': return { muro: 'se spinge: muro', contropiede: 'se sta fermo: +80%', finta: 'se spinge: a vuoto' }[t.react] ?? '';
    default: return '';
  }
}
