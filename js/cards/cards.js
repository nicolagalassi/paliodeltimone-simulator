/**
 * Le carte della tirata.
 *
 * Nella tirata a carte il Chiamatore non tiene premuto un comando: a ogni
 * battuta sceglie una carta coperta, l'avversario fa lo stesso, le due carte si
 * girano insieme e il motore fisico gioca la battuta. Nessuno dei due può
 * reagire alla mossa dell'altro: bisogna prevederla.
 *
 * Il mazzo È la formazione. Ogni tiratore porta due carte del suo ruolo, e la
 * loro forza viene dalle sue statistiche: la Spallata di un Esterno da 95 di
 * Forza pesa molto più di quella di uno da 50. Il Freno è sempre in mano,
 * fuori dal mazzo: una squadra può sempre piantarsi.
 */

import { TUNING, normAngle, activeArm } from '../match/engine.js';

/** Secondi di tirata giocati da ogni battuta. */
export const BATTUTA_SECONDS = 5;
/** Carte in mano a inizio battuta (il Freno non conta: è sempre disponibile). */
export const HAND_SIZE = 4;

/**
 * I tipi di carta. `kind` è il comando che la carta dà al motore.
 * `effect` descrive in breve che cosa fa, per la carta e per il registro.
 */
export const CARD_TYPES = {
  spinta: {
    name: 'Spinta', kind: 'push',
    text: 'Tutta la squadra avanti, spalle al palo.',
  },
  spallata: {
    name: 'Spallata', kind: 'push',
    text: 'Gli Esterni caricano: più spinta, molto più fiato.',
  },
  tenuta: {
    name: 'Tenuta', kind: 'hold',
    text: 'I Mediani tengono il palo: lo riportano al centro dell’arco e lo fermano.',
  },
  strappo: {
    name: 'Strappo', kind: 'pull',
    text: 'Il palo a sé di slancio: forte all’inizio, poi cala.',
  },
  sotto: {
    name: 'Sotto', kind: 'sotto',
    text: 'Si passa sotto il palo e si riparte spingendo dall’altra parte.',
  },
  lampo: {
    name: 'Passaggio lampo', kind: 'sotto',
    text: 'Gli Interni guidano il passaggio: rapido e sicuro.',
  },
  freno: {
    name: 'Freno', kind: 'brake',
    text: 'Ci si pianta: smorza la giostra e si rifiata.',
  },
};

/** Le due carte che ogni posizione porta nel mazzo. */
export const ROLE_CARDS = {
  esterno: ['spinta', 'spallata'],
  mediano: ['tenuta', 'strappo'],
  interno: ['sotto', 'lampo'],
};

const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
const pct = (x) => {
  const v = Math.round((x - 1) * 100);
  return v === 0 ? '±0%' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
};

/**
 * Una carta portata da un tiratore. Le statistiche di chi la porta ne fanno la
 * forza: è la ragione per cui comporre la formazione conta anche qui.
 */
export function makeCard(type, shooter = null, uid = type) {
  const card = { uid, type, source: shooter ? { name: shooter.name, role: shooter.role } : null };
  const st = shooter?.stats;

  if (type === 'spallata') {
    card.boost = 1.12 + 0.36 * norm(st?.forza ?? 60, 40, 95);
    card.drain = 1.9;
  } else if (type === 'tenuta') {
    // Tenere il palo è coordinazione più che forza.
    card.boost = 0.78 + 0.22 * norm(st?.squadra ?? 60, 30, 95);
  } else if (type === 'strappo') {
    card.boost = 0.95 + 0.25 * norm(st?.forza ?? 60, 40, 95);
  } else if (type === 'lampo') {
    card.sure = true;
    card.fast = 0.78 - 0.28 * norm(st?.agilita ?? 60, 30, 95);
  }
  return card;
}

/** Il Freno: sempre in mano, non si pesca e non si consuma. */
export const FRENO = Object.freeze(makeCard('freno', null, 'freno'));

/** Riga breve degli effetti di una carta, per mostrarla sulla carta stessa. */
export function cardEffect(card) {
  switch (card.type) {
    case 'spallata': return `spinta ${pct(card.boost)} · fiato ×${card.drain.toFixed(1)}`;
    case 'tenuta': return `ferma il palo nell’arco · resa ${Math.round(card.boost * 100)}%`;
    case 'strappo': return `strappo ${pct(card.boost)}, poi cala`;
    case 'lampo': return `sotto sicuro · ${Math.round((1 - card.fast) * 100)}% più rapido`;
    case 'sotto': return 'riesce se la giostra non è lanciata';
    case 'spinta': return 'spinta piena';
    case 'freno': return 'smorza la giostra · rifiata';
    default: return '';
  }
}

/** Il mazzo di una squadra: due carte per tiratore, secondo il suo ruolo. */
export function buildDeck(roster) {
  const deck = [];
  roster.forEach((s, i) => {
    for (const type of ROLE_CARDS[s.role] ?? ['spinta', 'spinta']) {
      deck.push(makeCard(type, s, `${type}-${i}-${deck.length}`));
    }
  });
  return deck;
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Mazzo, mano e scarti di una squadra durante la tirata. */
export function createHand(deck, rng) {
  return { draw: shuffle(deck, rng), discard: [], hand: [] };
}

/** Si pesca fino a HAND_SIZE; finito il mazzo si rimescolano gli scarti. */
export function fillHand(h, rng) {
  while (h.hand.length < HAND_SIZE) {
    if (!h.draw.length) {
      if (!h.discard.length) break;
      h.draw = shuffle(h.discard, rng);
      h.discard = [];
    }
    h.hand.push(h.draw.pop());
  }
  return h.hand;
}

/** Le carte giocabili in questo momento: la mano più il Freno. */
export const playable = (h) => [...h.hand, FRENO];

/** Gioca una carta: lascia la mano e finisce fra gli scarti (il Freno resta). */
export function playCard(h, card) {
  if (card.type === 'freno') return;
  const idx = h.hand.findIndex((c) => c.uid === card.uid);
  if (idx >= 0) h.discard.push(...h.hand.splice(idx, 1));
}

/**
 * Probabilità che la chiamata esca eseguita male. È il Gioco di squadra: una
 * squadra affiatata esegue sempre, una slegata a volte segue a metà.
 */
export function misfireChance(team) {
  return Math.max(0, Math.min(0.3, 0.6 * (0.72 - (team.discipline ?? 0.6))));
}

/** Quanto rende una chiamata eseguita male. */
export const MISFIRE_GAIN = 0.62;
/** Secondi di ritardo di un sotto chiamato male: la squadra esita. */
export const MISFIRE_DELAY = 1.0;

/**
 * Il piano di una battuta: una funzione che a ogni passo restituisce il
 * comando per il motore. Le carte di spinta, tirata e freno danno lo stesso
 * comando per tutta la battuta; il sotto si chiama, si aspetta che il passaggio
 * finisca e poi si riparte spingendo — è quello che rende il sotto una giocata
 * e non un buco di cinque secondi.
 */
export function makePlan(card, { misfire = false } = {}) {
  const kind = CARD_TYPES[card.type].kind;
  const k = misfire ? MISFIRE_GAIN : 1;

  if (kind === 'push') return () => ({ type: 'push', boost: (card.boost ?? 1) * k, drain: card.drain ?? 1 });
  if (kind === 'pull') return () => ({ type: 'pull', boost: (card.boost ?? 1) * k });
  if (kind === 'brake') return () => ({ type: 'brake', boost: k });

  /* Tenuta: un piccolo controllore. Si vuole il proprio braccio al centro
   * dell'arco e il timone fermo: se serve ruotare si spinge o si tira, secondo
   * come si è girati; quando si è a posto ci si pianta. Rende meno di una
   * spinta piena, quindi fuori zona conviene avanzare spingendo: la Tenuta è
   * la carta di chi l'arco l'ha già raggiunto. */
  if (kind === 'hold') {
    const boost = (card.boost ?? 0.85) * k;
    return (m, i) => {
      const off = normAngle(activeArm(m, i) - TUNING.ZONE_CENTER);
      const u = -(off + 2.2 * m.omega);
      if (Math.abs(u) < 0.03) return { type: 'brake', boost };
      const want = Math.sign(u);
      return want === m.rt[i].facing
        ? { type: 'push', boost }
        : { type: 'pull', boost };
    };
  }

  // sotto: si chiama finché non parte, poi si spinge.
  let elapsed = 0;
  let issued = false;
  let started = false;
  const delay = misfire ? MISFIRE_DELAY : 0;
  const sottoCmd = {
    type: 'sotto',
    sure: misfire ? false : !!card.sure,
    fast: misfire ? 1 : (card.fast ?? 1),
  };
  return (m, i) => {
    elapsed += TUNING.STEP;
    const rt = m.rt[i];
    if (!started) {
      if (issued && rt.sottoTimer > 0) started = true;
      else if (rt.sottoTimer > 0 || elapsed < delay) return { type: 'idle' };
      else { issued = true; return sottoCmd; }
    }
    return { type: 'push' };
  };
}

/**
 * La carta avvicina il proprio palo all'arco, con l'orientamento attuale?
 * È l'indicazione "→ palio" sulle carte, la stessa dei pulsanti in tempo reale.
 */
export function cardTowardGoal(m, i, card) {
  const off = normAngle(activeArm(m, i) - TUNING.ZONE_CENTER);
  if (Math.abs(off) <= TUNING.ZONE_HALF) return false;     // già dentro: si tratta di restarci
  const pushToward = m.rt[i].facing === -Math.sign(off);
  const kind = CARD_TYPES[card.type].kind;
  if (kind === 'push') return pushToward;
  if (kind === 'pull') return !pushToward;
  if (kind === 'sotto') return !pushToward;               // dopo il passaggio si spinge al contrario
  if (kind === 'hold') return true;                       // lavora sempre verso l'arco
  return false;
}
