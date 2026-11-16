/**
 * Sessione della tirata a carte: mazzi, mani, scelte, rivelazione.
 *
 * La stessa sessione governa la tirata giocata e quella simulata fra due IA,
 * esattamente come il motore fisico è lo stesso per il tempo reale e per la
 * simulazione: gli incontri risolti senza disegnarli seguono le stesse regole
 * di quelli che il giocatore chiama di persona.
 */

import { createMatch, endOnTime } from '../match/engine.js';
import { makeRng } from '../core/rng.js';
import { getFaction } from '../data/factions.js';
import {
  BATTUTA_SECONDS, buildDeck, createHand, fillHand, playable, playCard, makePlan, misfireChance,
} from './cards.js';
import { runBattuta, createBattutaRunner } from './battuta.js';
import { createCardAi } from './cardAi.js';

const styleOf = (team) => getFaction(team.factionId).aiStyle;

/**
 * @param {object} cfg
 * @param {object} cfg.homeTeam      squadra pronta per il motore (indice 0)
 * @param {object} cfg.awayTeam      squadra pronta per il motore (indice 1)
 * @param {number} cfg.battute       battute della tirata
 * @param {number} cfg.hold          secondi consecutivi in zona per vincere
 * @param {number|string} cfg.seed
 * @param {[boolean, boolean]} [cfg.ai]  quali lati chiama l'IA
 */
export function createCardSession({ homeTeam, awayTeam, battute, hold, seed, ai = [true, true] }) {
  const rng = makeRng(seed);
  const m = createMatch({
    teams: [homeTeam, awayTeam],
    preset: { duration: battute * BATTUTA_SECONDS, hold },
    rng,
  });
  const decks = [buildDeck(homeTeam.roster), buildDeck(awayTeam.roster)];
  const hands = decks.map((d) => createHand(d, rng));
  const ais = [0, 1].map((i) => (ai[i]
    ? createCardAi(i, styleOf(m.teams[i]), rng, decks[1 - i])
    : null));
  const history = [];
  let battuta = 0;            // battute già giocate
  let hidden = [null, null];  // carte già scelte dall'IA, coperte

  return {
    m,
    battute,
    hands,
    history,
    ais,
    get battuta() { return battuta; },
    get over() { return m.finished || battuta >= battute; },

    /** Si pesca e l'IA sceglie, a carte coperte. */
    begin() {
      hands.forEach((h) => fillHand(h, rng));
      const ctx = { battute, battutaIndex: battuta };
      hidden = [0, 1].map((i) => (ais[i] ? ais[i].choose(m, playable(hands[i]), ctx) : null));
    },

    /** Carte che il lato i può giocare in questa battuta. */
    options(i) { return playable(hands[i]); },

    /**
     * Le carte si scoprono insieme. Per i lati umani si passa la loro scelta;
     * per i lati dell'IA conta quella fatta in `begin`.
     * @returns {{battuta:number, cards:Array, misfire:boolean[], plans:Function[]}}
     */
    reveal(humanPicks = [null, null]) {
      const cards = [0, 1].map((i) => (ais[i] ? hidden[i] : humanPicks[i]));
      cards.forEach((c, i) => {
        playCard(hands[i], c);
        ais[1 - i]?.observe(c.type);
      });
      // La disciplina: con poco Gioco di squadra la chiamata può uscire a metà.
      const misfire = [0, 1].map((i) => rng() < misfireChance(m.teams[i]));
      const plans = cards.map((c, i) => makePlan(c, { misfire: misfire[i] }));
      const entry = { battuta: battuta + 1, cards, misfire };
      history.push(entry);
      return { ...entry, plans };
    },

    /** Esecuzione animata della battuta appena scoperta. */
    runner(plans) {
      return createBattutaRunner(m, plans[0], plans[1], { battute, index: battuta });
    },

    /** Esecuzione immediata, senza animazione. */
    play(plans) { runBattuta(m, plans[0], plans[1], battute, battuta); },

    /** Chiude la battuta e passa alla successiva. */
    next() {
      battuta++;
      if (battuta >= battute) endOnTime(m);
    },
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

/** Esito nella stessa forma delle tirate in tempo reale. */
export function toResult(outcome) {
  return {
    winner: outcome.winner,
    reason: outcome.reason,
    holdHome: round1(outcome.holdHome),
    holdAway: round1(outcome.holdAway),
    proximityHome: round1(outcome.proximityHome),
    proximityAway: round1(outcome.proximityAway),
    elapsed: round1(outcome.elapsed),
  };
}

/** Tirata a carte fra due IA, risolta senza disegnarla. */
export function simulateCardFixture({ homeTeam, awayTeam, battute, hold, seed }) {
  const s = createCardSession({ homeTeam, awayTeam, battute, hold, seed });
  while (!s.over) {
    s.begin();
    const { plans } = s.reveal();
    s.play(plans);
    s.next();
  }
  return toResult(endOnTime(s.m));
}
