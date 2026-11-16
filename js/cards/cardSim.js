/**
 * Sessione della tirata a carte: mazzi, mani, energia, sequenze, bonus.
 *
 * La stessa sessione governa la tirata giocata e quella simulata fra due IA,
 * così gli incontri risolti senza disegnarli seguono le stesse regole di
 * quelli che il giocatore chiama di persona — bonus compresi.
 *
 * Ogni battuta:
 *   begin()        si pesca, si calcola l'energia, l'IA sceglie (coperta)
 *   reveal(seqs)   le sequenze si scoprono insieme
 *   runner()/play() il motore gioca i cinque secondi
 *   next()         si scarta, si passa alla battuta dopo, e si dice chi ha
 *                  guadagnato un bonus con i secondi in zona
 *   grant(i, id)   si assegna il bonus scelto
 */

import { createMatch, endOnTime } from '../match/engine.js';
import { makeRng } from '../core/rng.js';
import { getFaction } from '../data/factions.js';
import {
  BATTUTA_SECONDS, BASE_ENERGY, HAND_SIZE, createHand, drawHand, discardHand, playable,
  addToHand, makeSequencePlan, misfireChance, seqCarry, whyNot,
} from './cards.js';
import {
  BONUS_EVERY, MAX_BONUS_PER_TIRATA, BONUSES, grantBonus, modsOf, offerBonuses, aiPickBonus,
} from './bonus.js';
import { runBattuta, createBattutaRunner } from './battuta.js';
import { createCardAi } from './cardAi.js';

const styleOf = (team) => getFaction(team.factionId).aiStyle;

/** Respiro del motore dopo un sotto: basta la regola "un sotto per battuta". */
const CARD_SOTTO_COOLDOWN = 0.3;

/**
 * @param {object} cfg
 * @param {object} cfg.homeTeam      squadra pronta per il motore (indice 0)
 * @param {object} cfg.awayTeam      squadra pronta per il motore (indice 1)
 * @param {[object, object]} cfg.loadouts  mazzo e bonus delle due squadre nella
 *   run; la sessione li aggiorna quando si guadagnano bonus
 * @param {number} cfg.battute
 * @param {number} cfg.hold
 * @param {number|string} cfg.seed
 * @param {[boolean, boolean]} [cfg.ai]  quali lati chiama l'IA
 */
export function createCardSession({
  homeTeam, awayTeam, loadouts, battute, hold, seed, ai = [true, true],
}) {
  const rng = makeRng(seed);
  const m = createMatch({
    teams: [homeTeam, awayTeam],
    preset: { duration: battute * BATTUTA_SECONDS, hold },
    rng,
    noFatigue: true,
    sottoCooldown: CARD_SOTTO_COOLDOWN,
  });
  const mods = loadouts.map(modsOf);
  const hands = loadouts.map((l) => createHand(l.deck, rng));
  const ais = [0, 1].map((i) => (ai[i] ? createCardAi(i, styleOf(m.teams[i]), rng) : null));
  const carry = [0, 0];          // energia messa da parte col Freno
  const energy = [BASE_ENERGY, BASE_ENERGY];
  const earned = [0, 0];         // bonus già guadagnati in questa tirata
  const history = [];
  let battuta = 0;
  let hidden = [null, null];

  const session = {
    m,
    battute,
    hands,
    history,
    loadouts,
    get mods() { return mods; },
    get energy() { return energy; },
    get battuta() { return battuta; },
    get over() { return m.finished || battuta >= battute; },

    /** Si pesca, si calcola l'energia e l'IA sceglie la sua sequenza, coperta. */
    begin() {
      for (let i = 0; i < 2; i++) {
        drawHand(hands[i], rng, HAND_SIZE + mods[i].draw);
        energy[i] = BASE_ENERGY + mods[i].energy + carry[i];
        carry[i] = 0;
      }
      hidden = [0, 1].map((i) => (ais[i] ? ais[i].choose(m, {
        options: playable(hands[i]),
        energy: energy[i],
        mods: mods[i],
        oppDeck: loadouts[1 - i].deck,
        oppEnergy: energy[1 - i],
        oppMods: mods[1 - i],
        battute,
        battutaIndex: battuta,
      }) : null));
    },

    /** Carte che il lato i può giocare in questa battuta. */
    options(i) { return playable(hands[i]); },

    /**
     * Le sequenze si scoprono insieme. Per i lati umani si passa la loro;
     * per i lati dell'IA conta quella scelta in `begin`.
     */
    reveal(humanSeqs = [null, null]) {
      const seqs = [0, 1].map((i) => {
        const raw = ais[i] ? hidden[i] : (humanSeqs[i] ?? []);
        // Per sicurezza si rifà il controllo: una sequenza fuori regola si tronca.
        const ok = [];
        for (const c of raw) if (!whyNot(ok, c, energy[i])) ok.push(c);
        return ok;
      });
      seqs.forEach((seq, i) => {
        ais[1 - i]?.observe(seq);
        carry[i] = seqCarry(seq, mods[i]);
      });
      // La disciplina: con poco Gioco di squadra una chiamata può uscire a metà.
      const misfire = seqs.map((seq, i) => seq.map(() => rng() < misfireChance(m.teams[i], mods[i])));
      const plans = seqs.map((seq, i) => makeSequencePlan(seq, mods[i], misfire[i]));
      const entry = { battuta: battuta + 1, seqs, misfire };
      history.push(entry);
      return { ...entry, plans };
    },

    /** Esecuzione animata della battuta appena scoperta. */
    runner(plans) {
      return createBattutaRunner(m, plans[0], plans[1], { battute, index: battuta });
    },

    /** Esecuzione immediata, senza animazione. */
    play(plans) { runBattuta(m, plans[0], plans[1], battute, battuta); },

    /**
     * Chiude la battuta. Restituisce, per ciascuna squadra, quanti bonus ha
     * guadagnato con i secondi passati in zona e non ha ancora ricevuto.
     */
    next() {
      hands.forEach(discardHand);
      battuta++;
      if (battuta >= battute) endOnTime(m);
      return session.pendingBonuses();
    },

    /** Bonus guadagnati e non ancora assegnati: [squadra 0, squadra 1]. */
    pendingBonuses() {
      return [0, 1].map((i) => {
        const due = Math.min(MAX_BONUS_PER_TIRATA, Math.floor((m.rt[i].timeInZone + 1e-9) / BONUS_EVERY));
        return Math.max(0, due - earned[i]);
      });
    },

    /** Tre bonus fra cui scegliere, per la squadra i. */
    offers(i) { return offerBonuses(loadouts[i], rng); },

    /** Assegna un bonus guadagnato alla squadra i. */
    grant(i, id) {
      grantBonus(loadouts[i], id);
      earned[i]++;
      if (BONUSES[id].kind === 'card') addToHand(hands[i], BONUSES[id].card);
      mods[i] = modsOf(loadouts[i]);
    },

    /** L'IA sceglie e riceve tutti i bonus che le spettano. */
    grantAiBonuses() {
      const due = session.pendingBonuses();
      for (let i = 0; i < 2; i++) {
        if (!ais[i]) continue;
        for (let k = 0; k < due[i]; k++) {
          session.grant(i, aiPickBonus(session.offers(i), ais[i].style, rng));
        }
      }
    },

    /** Stile del chiamatore del lato i (per la scelta dei bonus da fuori). */
    styleOf(i) { return styleOf(m.teams[i]); },
    rng,
  };
  return session;
}

const round1 = (v) => Math.round(v * 10) / 10;

/** Esito nella forma registrata dal calendario. */
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

/**
 * Tirata a carte fra due IA, risolta senza disegnarla. I bonus guadagnati in
 * zona finiscono nei loro `loadouts`, come in una tirata giocata.
 */
export function simulateCardFixture({ homeTeam, awayTeam, loadouts, battute, hold, seed }) {
  const s = createCardSession({ homeTeam, awayTeam, loadouts, battute, hold, seed });
  while (!s.over) {
    s.begin();
    const { plans } = s.reveal();
    s.play(plans);
    s.next();
    s.grantAiBonuses();
  }
  endOnTime(s.m);
  s.grantAiBonuses();
  return toResult(s.m.outcome);
}
