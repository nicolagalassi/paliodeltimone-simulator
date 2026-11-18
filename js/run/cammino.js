/**
 * Il Cammino del Palio: la modalità roguelike per un giocatore.
 *
 * Si parte con il mazzo base, un primo bonus e tre cuori. Si sale la mappa una
 * tappa alla volta: tirate contro i quartieri rivali, eventi, bottega,
 * allenamenti, osterie. Ogni tirata persa costa un cuore; senza cuori il
 * cammino finisce. In cima aspetta il Palio, contro il rivale storico: vincerlo
 * è vincere la run.
 *
 * Qui stanno solo le regole e lo stato (salvabile così com'è). Le schermate sono
 * in `ui/camminoUI.js`.
 */

import { BASE_DECK, CARD_TYPES } from '../cards/cards.js';
import {
  newLoadout, grantBonus, offerBonuses, aiPickBonus, BONUSES,
} from '../cards/bonus.js';
import { makeRng, hashSeed } from '../core/rng.js';
import { FACTIONS, getFaction } from '../data/factions.js';
import { generateMap, nodeById, reachable } from './map.js';

export const VERSION = 5;
export const START_HEARTS = 3;
/** Sotto questa soglia il mazzo non si assottiglia più: la mano è di cinque. */
export const MIN_DECK = 7;
export const PRICES = { card: 35, effect: 50, remove: 25, heart: 40 };
export const REWARD = { tirata: 15, rivale: 30, loss: 5 };

/**
 * Quanto dura una tirata del cammino. Le prime sono brevi — si impara e si
 * va avanti — poi si allungano fino al Palio. Misurate in simulazione: una
 * tirata da 6 battute finisce in media in ~5 battute (mezzo minuto di gioco),
 * una da 12 in ~10.
 */
export function tirataFormat(node) {
  if (node.type === 'palio') return { battute: 12, hold: 6 };
  if (node.type === 'rivale') return { battute: 10, hold: 5 };
  if (node.row <= 2) return { battute: 6, hold: 4 };
  return { battute: 8, hold: 5 };
}

/**
 * Quanti bonus ha un avversario. Crescono salendo la mappa, così il cammino si
 * fa più duro man mano che il mazzo del giocatore si arricchisce.
 */
export function opponentBonusCount(node) {
  if (node.type === 'palio') return 6;
  const base = Math.floor(node.row * 0.5);
  return node.type === 'rivale' ? 2 + base : base;
}

export function newCammino({
  seed, factionId, loadout,
}) {
  const rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
  const rivals = FACTIONS.map((f) => f.id).filter((id) => id !== factionId);
  const boss = rng.pick(rivals);
  return {
    version: VERSION,
    kind: 'cammino',
    mode: 'cammino',
    seed,
    factionId,
    humans: [factionId],
    loadout,
    hearts: START_HEARTS,
    maxHearts: START_HEARTS,
    fiorini: 0,
    boss,
    map: generateMap(rng, rivals, boss),
    pos: null,                 // tappa in cui ci si trova
    pending: false,            // la tappa attuale non è ancora risolta
    followUp: null,            // una scelta rimasta in sospeso (bonus, carta da togliere)
    bought: [],                // ciò che si è già comprato nella bottega attuale
    visited: [],
    log: [],                   // righe di diario: { node, text }
    stage: 'map',              // 'map' | 'done'
    outcome: null,             // 'win' | 'lose'
    createdAt: Date.now(),
  };
}

/** Un generatore riproducibile per una tappa: rigiocando la stessa run, stesse offerte. */
export function nodeRng(state, nodeId, salt = 0) {
  return makeRng((Number(state.seed) ^ hashSeed(nodeId) ^ (salt * 0x45d9f3b)) >>> 0);
}

export const currentNode = (state) => (state.pos ? nodeById(state.map, state.pos) : null);
export const nextNodes = (state) => reachable(state.map, state.pos).map((id) => nodeById(state.map, id));

/** Si entra in una tappa: diventa la posizione attuale. */
export function enterNode(state, id) {
  if (!reachable(state.map, state.pos).includes(id)) throw new Error(`tappa non raggiungibile: ${id}`);
  state.pos = id;
  state.visited.push(id);
}

export function addLog(state, text) {
  state.log.push({ node: state.pos, text });
}

/* ============================ tirate ============================ */

/** Mazzo e bonus dell'avversario di una tappa: il base più i bonus della sua forza. */
export function opponentLoadout(state, node) {
  const rng = nodeRng(state, node.id, 7);
  const lo = newLoadout(BASE_DECK);
  const style = getFaction(node.opp).aiStyle;
  for (let k = 0; k < opponentBonusCount(node); k++) {
    grantBonus(lo, aiPickBonus(offerBonuses(lo, rng), style, rng));
  }
  return lo;
}

/**
 * Registra l'esito di una tirata della tappa attuale.
 * @param {'win'|'loss'|'draw'} esito  dal punto di vista del giocatore
 * @returns {{ fiorini:number, heartLost:boolean, bonusChoice:boolean, ended:null|'win'|'lose' }}
 */
export function settleTirata(state, esito) {
  const node = currentNode(state);
  const opp = getFaction(node.opp).name;
  const out = {
    fiorini: 0, heartLost: false, bonusChoice: false, ended: null,
  };

  if (node.type === 'palio') {
    out.ended = esito === 'win' ? 'win' : 'lose';
    state.stage = 'done';
    state.outcome = out.ended;
    addLog(state, esito === 'win' ? `Palio vinto contro ${opp}!` : `Palio perso contro ${opp}.`);
    return out;
  }

  if (esito === 'win') {
    out.fiorini = node.type === 'rivale' ? REWARD.rivale : REWARD.tirata;
    // Ogni vittoria vale un bonus a scelta: con tirate brevi i secondi in zona
    // ne danno pochi, e il mazzo deve comunque crescere salendo.
    out.bonusChoice = true;
    addLog(state, `Vinta contro ${opp} · +${out.fiorini} fiorini`);
  } else if (esito === 'loss') {
    out.fiorini = REWARD.loss;
    out.heartLost = true;
    state.hearts -= 1;
    addLog(state, `Persa contro ${opp} · −1 cuore`);
  } else {
    out.fiorini = REWARD.loss;
    addLog(state, `Pari contro ${opp}`);
  }
  state.fiorini += out.fiorini;

  if (state.hearts <= 0) {
    state.stage = 'done';
    state.outcome = 'lose';
    out.ended = 'lose';
    addLog(state, 'Senza più cuori: il cammino finisce qui.');
  }
  return out;
}

/* ============================ mazzo ============================ */

/** Le carte del mazzo, raggruppate: [{ type, n }]. */
export function deckGroups(loadout) {
  const counts = new Map();
  for (const t of loadout.deck) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([type, n]) => ({ type, n }));
}

export const canRemove = (state) => state.loadout.deck.length > MIN_DECK;

export function removeCard(state, type) {
  const i = state.loadout.deck.indexOf(type);
  if (i < 0 || !canRemove(state)) return false;
  state.loadout.deck.splice(i, 1);
  addLog(state, `Tolta una ${CARD_TYPES[type].name} dal mazzo`);
  return true;
}

export function duplicateCard(state, type) {
  if (!state.loadout.deck.includes(type)) return false;
  state.loadout.deck.push(type);
  addLog(state, `Raddoppiata la ${CARD_TYPES[type].name}`);
  return true;
}

export function gainBonus(state, id, why = '') {
  grantBonus(state.loadout, id);
  const b = BONUSES[id];
  const name = b.kind === 'card' ? CARD_TYPES[b.card].name : b.name;
  addLog(state, `${why ? `${why}: ` : ''}${name}`);
}

export function healHeart(state) {
  if (state.hearts >= state.maxHearts) return false;
  state.hearts += 1;
  return true;
}

/* ============================ bottega ============================ */

/** La merce della bottega di questa tappa: tre bonus a prezzo, più i servizi. */
export function shopStock(state) {
  const rng = nodeRng(state, state.pos, 3);
  const bonuses = offerBonuses(state.loadout, rng, 3).map((id) => ({
    kind: 'bonus', id, price: BONUSES[id].kind === 'card' ? PRICES.card : PRICES.effect,
  }));
  return [
    ...bonuses,
    { kind: 'remove', price: PRICES.remove },
    { kind: 'heart', price: PRICES.heart },
  ];
}

/* ============================ eventi ============================ */

/**
 * Gli eventi in piazza. Ogni scelta ha un `effect` che modifica lo stato e
 * restituisce il racconto dell'esito; può chiedere un seguito all'interfaccia:
 *   { text, offers }   scegli un bonus fra questi
 *   { text, remove }   scegli una carta da togliere
 */
export const EVENTS = [
  {
    id: 'vino',
    title: 'Il vino del Moro',
    text: 'All’osteria del Moro i vecchi tiratori alzano i bicchieri al tuo quartiere e ti fanno posto al tavolo.',
    choices: [
      {
        label: 'Brinda con loro', detail: '+1 cuore',
        can: (s) => s.hearts < s.maxHearts,
        effect: (s) => { healHeart(s); return { text: 'Si canta fino a tardi. La squadra ritrova il morale.' }; },
      },
      {
        label: 'Fai i conti con l’oste', detail: '+20 fiorini',
        effect: (s) => { s.fiorini += 20; return { text: 'L’oste ti deve un favore, e paga.' }; },
      },
    ],
  },
  {
    id: 'vecchio',
    title: 'Il vecchio tiratore',
    text: 'Un anziano che ha tirato il timone per trent’anni ti ferma in piazza: “Ti insegno una cosa, se mi offri da bere.”',
    choices: [
      {
        label: 'Offrigli da bere', detail: '−15 fiorini · un bonus a scelta',
        can: (s) => s.fiorini >= 15,
        effect: (s, rng) => {
          s.fiorini -= 15;
          return { text: 'Parla per un’ora. Una cosa, però, è oro.', offers: offerBonuses(s.loadout, rng, 3) };
        },
      },
      {
        label: 'Ringrazia e tira dritto', detail: 'nulla',
        effect: () => ({ text: 'Il vecchio scuote la testa e torna al suo bicchiere.' }),
      },
    ],
  },
  {
    id: 'scommessa',
    title: 'La scommessa',
    text: 'Sotto il loggiato si raccolgono le puntate sulla prossima tirata. Uno scommettitore ti fa l’occhiolino.',
    choices: [
      {
        label: 'Punta 15 fiorini', detail: 'metà delle volte ne tornano 40',
        can: (s) => s.fiorini >= 15,
        effect: (s, rng) => {
          s.fiorini -= 15;
          if (rng() < 0.5) {
            s.fiorini += 40;
            return { text: 'Hai visto giusto: tornano 40 fiorini.' };
          }
          return { text: 'Lo scommettitore sparisce con la tua puntata.' };
        },
      },
      {
        label: 'Lascia perdere', detail: 'nulla',
        effect: () => ({ text: 'I fiorini restano in tasca.' }),
      },
    ],
  },
  {
    id: 'pioggia',
    title: 'Allenamento sotto la pioggia',
    text: 'Piove a dirotto, ma il capitano vuole provare i passaggi sotto il palo. I tiratori brontolano.',
    choices: [
      {
        label: 'Allenatevi lo stesso', detail: '−1 cuore · un bonus a scelta',
        can: (s) => s.hearts > 1,
        effect: (s, rng) => {
          s.hearts -= 1;
          return { text: 'Fango fino alle ginocchia, ma qualcosa è entrato nelle gambe.', offers: offerBonuses(s.loadout, rng, 3) };
        },
      },
      {
        label: 'Tutti al riparo', detail: 'nulla',
        effect: () => ({ text: 'Si aspetta che spiova giocando a carte.' }),
      },
    ],
  },
  {
    id: 'falegname',
    title: 'Il falegname del timone',
    text: 'Il falegname che ha costruito il timone ti mostra come si impugna davvero il palo. Ha anche un’idea su cosa lasciare a casa.',
    choices: [
      {
        label: 'Ascolta i suoi consigli', detail: 'togli una carta dal mazzo',
        can: canRemove,
        effect: () => ({ text: 'Meno chiamate, ma più chiare.', remove: true }),
      },
      {
        label: 'Comprale un’Àncora', detail: '−20 fiorini · Àncora nel mazzo',
        can: (s) => s.fiorini >= 20,
        effect: (s) => {
          s.fiorini -= 20;
          gainBonus(s, 'ancora', 'Dal falegname');
          return { text: 'Una presa che non molla per tre secondi.' };
        },
      },
    ],
  },
  {
    id: 'stornelli',
    title: 'Gli stornelli della contrada',
    text: 'Le donne del quartiere cantano stornelli sotto le finestre della squadra. Qualcuno passa con il cappello.',
    choices: [
      {
        label: 'Raccogli le offerte', detail: '+15 fiorini',
        effect: (s) => { s.fiorini += 15; return { text: 'Il cappello torna pieno.' }; },
      },
      {
        label: 'Offri tu da bere a tutti', detail: '−10 fiorini · +1 cuore',
        can: (s) => s.fiorini >= 10 && s.hearts < s.maxHearts,
        effect: (s) => { s.fiorini -= 10; healHeart(s); return { text: 'La piazza intera è con te.' }; },
      },
    ],
  },
];

/** L'evento di questa tappa. */
export function eventFor(state) {
  const rng = nodeRng(state, state.pos, 11);
  return EVENTS[Math.floor(rng() * EVENTS.length)];
}

/** Un generatore per gli esiti dell'evento (scommessa, offerte). */
export const eventRng = (state) => nodeRng(state, state.pos, 13);
