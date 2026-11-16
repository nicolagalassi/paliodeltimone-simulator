/**
 * La tirata a carte giocata: mani, scelta coperta, rivelazione, battuta animata.
 *
 * A ogni battuta il ciclo è sempre lo stesso:
 *   1. si pesca, e l'IA sceglie subito la sua carta — coperta;
 *   2. ogni Chiamatore umano sceglie la sua;
 *   3. le carte si scoprono insieme (e si vede se una chiamata esce a metà);
 *   4. il motore gioca i cinque secondi della battuta, animati sul campo.
 *
 * Nessuno vede la carta dell'altro prima di aver scelto la propria: è questo,
 * e non i riflessi, che decide la tirata.
 */

import { getFaction } from '../data/factions.js';
import { ROLE_BY_ID } from '../core/roster.js';
import { endOnTime } from '../match/engine.js';
import { createRenderer } from '../match/renderer.js';
import { prepareHud, updateHud, updateGiostra, showOutcome } from '../match/match.js';
import { CARD_TYPES, cardEffect, cardTowardGoal } from './cards.js';
import { createCardSession, toResult } from './cardSim.js';

const $ = (id) => document.getElementById(id);

/** La battuta scorre un po' più veloce del vero: cinque secondi sono tanti da guardare. */
const PLAYBACK_SPEED = 1.3;
/** Quanto restano scoperte le due carte prima che parta la battuta. */
const REVEAL_MS = 1200;

/* Tasti per scegliere la carta: il Giocatore 1 usa 1–5, il Giocatore 2 6–0. */
const KEYS = {
  1: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
  2: ['Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'],
};

const sideOf = (playerNo) => (playerNo === 2 ? 'b' : 'a');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Avvia la tirata a carte giocabile.
 * @param {object} cfg
 * @param {object} cfg.homeTeam
 * @param {object} cfg.awayTeam
 * @param {Array<{type:'ai'}|{type:'human',playerNo:1|2}>} cfg.controllers  [casa, trasferta]
 * @param {number} cfg.battute
 * @param {number} cfg.hold
 * @param {number|string} cfg.seed
 * @param {string} [cfg.title]
 * @param {boolean} [cfg.duo]
 * @returns {Promise<object>} risultato orientato home/away
 */
export function playCardMatch({ homeTeam, awayTeam, controllers, battute, hold, seed, title, duo = false }) {
  return new Promise((resolve) => {
    const session = createCardSession({
      homeTeam, awayTeam, battute, hold, seed,
      ai: controllers.map((c) => c.type !== 'human'),
    });
    const { m } = session;
    const factions = [getFaction(homeTeam.factionId), getFaction(awayTeam.factionId)];
    const colors = factions.map((f) => f.color);

    const humans = [];
    controllers.forEach((c, i) => {
      if (c.type === 'human') humans.push({ index: i, playerNo: c.playerNo, side: sideOf(c.playerNo) });
    });
    // A due umani sullo stesso schermo la mano resta coperta finché il suo
    // proprietario non la guarda: è l'equivalente di tenere le carte al petto.
    const covered = humans.length === 2;

    /* ---- la schermata passa in modalità carte ---- */
    $('commands-area').hidden = true;
    $('hand-area').hidden = false;
    $('hud-battuta').hidden = false;
    $('hud-battuta-tot').textContent = battute;
    $('battuta-reveal').hidden = true;
    $('battuta-log').replaceChildren();
    $('screen-match').classList.toggle('is-hotseat', duo && humans.length === 2);
    $('screen-match').classList.add('is-cards');
    $('hand-player-a').hidden = true;
    $('hand-player-b').hidden = true;
    for (const h of humans) {
      $(`hand-player-${h.side}`).hidden = false;
      $(`hand-label-${h.side}`).textContent = duo
        ? `Giocatore ${h.playerNo} · ${factions[h.index].name}`
        : 'La tua mano';
    }

    const els = prepareHud({ factions, colors, humans, duo, hold, title });
    const renderer = createRenderer($('field'));
    renderer.resize();
    const giostraFocus = humans.length === 1 ? humans[0].index : null;

    /* ---- disegno continuo; la fisica avanza solo durante la battuta ---- */
    let raf = 0;
    let last = performance.now();
    let paused = false;
    let running = null;          // { runner, done }

    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (running && !paused && running.runner.advance(dt * PLAYBACK_SPEED)) {
        const { done } = running;
        running = null;
        done();
      }
      renderer.draw(m, colors, now);
      updateHud(m, els, m.preset, factions, colors);
      updateGiostra(m, giostraFocus);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    /* ---- pausa: ferma solo l'animazione, la scelta non ha orologio ---- */
    const pauseOverlay = $('pause-overlay');
    const setPaused = (v) => {
      if (m.finished) return;
      paused = v;
      pauseOverlay.hidden = !v;
      last = performance.now();
    };
    $('btn-pause').onclick = () => setPaused(!paused);
    $('btn-resume').onclick = () => setPaused(false);
    const onPauseKey = (e) => {
      if (e.code !== 'KeyP' && e.code !== 'Escape') return;
      e.preventDefault();
      setPaused(!paused);
    };
    window.addEventListener('keydown', onPauseKey);

    /* ---- la mano ---- */
    const keyHandlers = [];

    function cardButton(card, h, faceUp) {
      const t = CARD_TYPES[card.type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card card-${t.kind}`;
      btn.dataset.type = card.type;
      if (!faceUp) {
        btn.classList.add('is-covered');
        btn.disabled = true;
        btn.append(Object.assign(document.createElement('span'), { className: 'card-back', textContent: '◆' }));
        return btn;
      }
      const role = card.source ? ROLE_BY_ID[card.source.role]?.short : null;
      const top = document.createElement('span');
      top.className = 'card-role';
      top.textContent = card.source ? `${role} · ${card.source.name.split(' ').pop()}` : 'sempre in mano';
      const name = document.createElement('strong');
      name.className = 'card-name';
      name.textContent = t.name;
      const eff = document.createElement('em');
      eff.className = 'card-effect';
      eff.textContent = cardEffect(card);
      btn.title = t.text;
      btn.append(top, name, eff);
      if (cardTowardGoal(m, h.index, card)) {
        btn.classList.add('is-toward');
        btn.append(Object.assign(document.createElement('span'), { className: 'card-toward', textContent: '→ palio' }));
      }
      return btn;
    }

    /** Fa scegliere una carta al giocatore umano h; risolve con la carta scelta. */
    function chooseFor(h) {
      return new Promise((done) => {
        const opts = session.options(h.index);
        const box = $(`hand-cards-${h.side}`);
        const status = $(`hand-status-${h.side}`);
        const peek = $(`hand-peek-${h.side}`);
        let open = !covered;

        const pick = (card) => {
          window.removeEventListener('keydown', onKey);
          peek.hidden = true;
          peek.onclick = null;
          // Dopo la scelta la mano si richiude: a due, l'altro non deve vederla.
          box.replaceChildren(...opts.map((c) => {
            const b = cardButton(c, h, !covered);
            if (c === card) b.classList.add('is-chosen');
            b.disabled = true;
            return b;
          }));
          status.textContent = covered ? '✓ chiamata pronta' : `hai chiamato ${CARD_TYPES[card.type].name}`;
          status.classList.add('is-ready');
          done(card);
        };

        const render = () => {
          box.replaceChildren(...opts.map((c, k) => {
            const b = cardButton(c, h, open);
            if (open) {
              b.addEventListener('click', () => pick(c));
              const key = KEYS[h.playerNo]?.[k];
              if (key) b.dataset.key = key.replace('Digit', '');
            }
            return b;
          }));
          peek.hidden = !covered;
          peek.textContent = open ? 'Copri le carte' : 'Guarda le carte';
          status.textContent = open ? 'scegli la chiamata' : 'carte coperte';
          status.classList.remove('is-ready');
        };

        peek.onclick = () => { open = !open; render(); };
        const onKey = (e) => {
          const k = KEYS[h.playerNo]?.indexOf(e.code) ?? -1;
          if (k < 0 || k >= opts.length) return;
          e.preventDefault();
          pick(opts[k]);
        };
        window.addEventListener('keydown', onKey);
        keyHandlers.push(onKey);
        render();
      });
    }

    /* ---- rivelazione e registro ---- */
    function revealSide(el, card, i, misfire) {
      el.replaceChildren();
      el.style.setProperty('--tc', colors[i]);
      const who = document.createElement('span');
      who.className = 'reveal-who';
      who.textContent = factions[i].name;
      const name = document.createElement('strong');
      name.textContent = CARD_TYPES[card.type].name;
      el.append(who, name);
      if (misfire) {
        el.append(Object.assign(document.createElement('em'), {
          className: 'reveal-misfire', textContent: 'la squadra segue a metà',
        }));
      }
    }

    function logBattuta(rev) {
      const li = document.createElement('li');
      const n = document.createElement('b');
      n.textContent = rev.battuta;
      li.append(n);
      rev.cards.forEach((c, i) => {
        const s = document.createElement('span');
        s.style.setProperty('--tc', colors[i]);
        s.textContent = CARD_TYPES[c.type].name + (rev.misfire[i] ? '½' : '');
        if (i === 1) li.append(document.createTextNode('·'));
        li.append(s);
      });
      const log = $('battuta-log');
      log.append(li);
      log.scrollLeft = log.scrollWidth;
    }

    /* ---- il ciclo delle battute ---- */
    async function loop() {
      while (!session.over) {
        session.begin();
        $('hud-battuta-n').textContent = session.battuta + 1;
        $('battuta-reveal').hidden = true;

        const chosen = await Promise.all(humans.map((h) => chooseFor(h)));
        const picks = [null, null];
        humans.forEach((h, k) => { picks[h.index] = chosen[k]; });

        const rev = session.reveal(picks);
        revealSide($('reveal-a'), rev.cards[0], 0, rev.misfire[0]);
        revealSide($('reveal-b'), rev.cards[1], 1, rev.misfire[1]);
        $('battuta-reveal').hidden = false;
        logBattuta(rev);
        await sleep(REVEAL_MS);

        await new Promise((done) => { running = { runner: session.runner(rev.plans), done }; });
        session.next();
      }
      endOnTime(m);
      finish();
    }

    function finish() {
      for (const h of keyHandlers) window.removeEventListener('keydown', h);
      showOutcome(m, factions, humans, duo, () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onPauseKey);
        document.title = 'Palio del Timone — Simulatore';
        resolve(toResult(m.outcome));
      });
    }

    loop();
  });
}
