/**
 * La tirata a carte giocata.
 *
 * A ogni battuta il ciclo è sempre lo stesso:
 *   1. si pesca, si ricarica l'energia, e l'IA sceglie la sua sequenza — coperta;
 *   2. ogni Chiamatore umano mette in fila le sue carte, entro energia e tempo;
 *   3. le sequenze si scoprono insieme (e si vede se qualche chiamata esce a metà);
 *   4. il motore gioca i cinque secondi della battuta, animati sul campo;
 *   5. chi ha accumulato abbastanza secondi in zona sceglie un bonus.
 *
 * Nessuno vede le carte dell'altro prima di aver chiamato le proprie: è questo,
 * e non i riflessi, che decide la tirata.
 */

import { getFaction } from '../data/factions.js';
import { endOnTime } from '../match/engine.js';
import { createRenderer } from '../match/renderer.js';
import {
  prepareHud, updateHud, updateGiostra, showOutcome, showEnergy,
} from '../match/match.js';
import {
  CARD_TYPES, BATTUTA_SECONDS, cardEffect, cardTowardGoal, whyNot, seqCost, seqDur,
} from './cards.js';
import { bonusInfo } from './bonus.js';
import { createCardSession, toResult } from './cardSim.js';
import { renderBonusChoice } from '../ui/bonusUI.js';

const $ = (id) => document.getElementById(id);

/** La battuta scorre un po' più veloce del vero: cinque secondi sono tanti da guardare. */
const PLAYBACK_SPEED = 1.3;
/** Quanto restano scoperte le due sequenze prima che parta la battuta. */
const REVEAL_MS = 1300;

const sideOf = (playerNo) => (playerNo === 2 ? 'b' : 'a');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const nameOf = (c) => CARD_TYPES[c.type].name;

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Avvia la tirata giocabile.
 * @param {object} cfg
 * @param {object} cfg.homeTeam
 * @param {object} cfg.awayTeam
 * @param {[object, object]} cfg.loadouts  mazzo e bonus delle due squadre (aggiornati dai bonus)
 * @param {Array<{type:'ai'}|{type:'human',playerNo:1|2}>} cfg.controllers  [casa, trasferta]
 * @param {number} cfg.battute
 * @param {number} cfg.hold
 * @param {number|string} cfg.seed
 * @param {string} [cfg.title]
 * @param {boolean} [cfg.duo]
 * @returns {Promise<object>} risultato orientato home/away
 */
export function playCardMatch({
  homeTeam, awayTeam, loadouts, controllers, battute, hold, seed, title, duo = false,
}) {
  return new Promise((resolve) => {
    const session = createCardSession({
      homeTeam, awayTeam, loadouts, battute, hold, seed,
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
    const hotseat = duo && humans.length === 2;

    /* ---- la schermata ---- */
    $('hud-battuta-tot').textContent = battute;
    $('battuta-reveal').hidden = true;
    $('bonus-overlay').hidden = true;
    $('battuta-log').replaceChildren();
    $('screen-match').classList.toggle('is-hotseat', hotseat);
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

    /* ================= la mano e la sequenza ================= */

    function cardButton(card, h, { faceUp, order = 0, reason = null }) {
      const t = CARD_TYPES[card.type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card card-${t.kind}`;
      btn.dataset.type = card.type;
      if (!faceUp) {
        btn.classList.add('is-covered');
        btn.disabled = true;
        btn.append(node('span', 'card-back', '◆'));
        return btn;
      }
      btn.title = t.text + (reason ? ` — ${reason}` : '');
      btn.append(
        node('span', 'card-cost', `${t.cost}⚡`),
        node('span', 'card-dur', `${t.dur} s`),
        node('strong', 'card-name', t.name),
        node('em', 'card-effect', cardEffect(card, session.mods[h.index])),
      );
      if (order) {
        btn.classList.add('is-queued');
        btn.append(node('span', 'card-order', String(order)));
      } else if (reason) {
        btn.classList.add('is-blocked');
      }
      if (!order && cardTowardGoal(m, h.index, card)) {
        btn.classList.add('is-toward');
        btn.append(node('span', 'card-toward', '→ palio'));
      }
      return btn;
    }

    function renderEnergy(h, seq) {
      const total = session.energy[h.index];
      const left = total - seqCost(seq);
      const box = $(`hand-energy-${h.side}`);
      box.replaceChildren(
        ...Array.from({ length: total }, (_, k) => node('span', k < left ? 'pip is-on' : 'pip', '⚡')),
        node('span', 'pip-count', `${left}/${total}`),
      );
    }

    function renderTimeline(h, seq, onRemove) {
      const box = $(`hand-timeline-${h.side}`);
      const blocks = seq.map((c, k) => {
        const t = CARD_TYPES[c.type];
        const b = node('button', `tl-block card-${t.kind}`, t.name);
        b.type = 'button';
        b.style.flexGrow = t.dur;
        b.title = `${t.name} · ${t.dur} s — tocca per toglierla`;
        if (onRemove) b.addEventListener('click', () => onRemove(k));
        else b.disabled = true;
        return b;
      });
      const free = BATTUTA_SECONDS - seqDur(seq);
      if (free > 1e-9) {
        const f = node('span', 'tl-free', seq.length ? `${free} s presa` : '5 s · aggiungi carte');
        f.style.flexGrow = free;
        blocks.push(f);
      }
      box.replaceChildren(...blocks);
    }

    /** Fa costruire la sequenza al giocatore umano h; risolve con la sequenza chiamata. */
    function buildSequence(h) {
      return new Promise((done) => {
        const opts = session.options(h.index);
        const energy = session.energy[h.index];
        const box = $(`hand-cards-${h.side}`);
        const status = $(`hand-status-${h.side}`);
        const peek = $(`hand-peek-${h.side}`);
        const undo = $(`hand-undo-${h.side}`);
        const go = $(`hand-go-${h.side}`);
        let seq = [];
        let open = !covered;
        const usesKeys = h.playerNo === 1;

        const add = (c) => { if (!whyNot(seq, c, energy)) { seq = [...seq, c]; render(); } };
        const removeAt = (k) => { seq = seq.filter((_, j) => j !== k); render(); };

        function render() {
          box.replaceChildren(...opts.map((c, k) => {
            const at = seq.findIndex((x) => x.uid === c.uid);
            const reason = at >= 0 ? null : whyNot(seq, c, energy);
            const b = cardButton(c, h, { faceUp: open, order: at + 1, reason });
            if (open) {
              if (usesKeys && k < 9) b.append(node('span', 'card-key', String(k + 1)));
              b.addEventListener('click', () => (at >= 0 ? removeAt(at) : add(c)));
            }
            return b;
          }));
          if (open) {
            renderEnergy(h, seq);
            renderTimeline(h, seq, removeAt);
          } else {
            $(`hand-energy-${h.side}`).replaceChildren(node('span', 'pip-count', `${energy}⚡`));
            $(`hand-timeline-${h.side}`).replaceChildren(node('span', 'tl-free', 'sequenza coperta'));
          }
          peek.hidden = !covered;
          peek.textContent = open ? 'Copri le carte' : 'Guarda le carte';
          undo.hidden = !open;
          undo.disabled = !seq.length;
          go.hidden = !open;
          go.disabled = false;
          go.textContent = seq.length ? 'Chiama' : 'Chiama: solo presa';
          status.textContent = open ? 'metti in fila le carte' : 'carte coperte';
          status.classList.remove('is-ready');
        }

        function confirm() {
          window.removeEventListener('keydown', onKey);
          peek.onclick = null;
          undo.onclick = null;
          go.onclick = null;
          peek.hidden = true;
          undo.hidden = true;
          go.hidden = true;
          // Dopo la chiamata la mano si richiude: a due, l'altro non deve vederla.
          box.replaceChildren(...opts.map((c) => {
            const at = seq.findIndex((x) => x.uid === c.uid);
            const b = cardButton(c, h, { faceUp: !covered, order: covered ? 0 : at + 1 });
            b.disabled = true;
            return b;
          }));
          if (covered) {
            $(`hand-timeline-${h.side}`).replaceChildren(node('span', 'tl-free', 'chiamata coperta'));
          } else {
            renderTimeline(h, seq, null);
          }
          status.textContent = covered ? '✓ chiamata pronta'
            : `hai chiamato ${seq.length ? seq.map(nameOf).join(' → ') : 'solo presa'}`;
          status.classList.add('is-ready');
          done(seq);
        }

        const onKey = (e) => {
          if (!usesKeys || !open) return;
          if (/^Digit[1-9]$/.test(e.code)) {
            const k = Number(e.code.slice(5)) - 1;
            if (k < opts.length) {
              e.preventDefault();
              const at = seq.findIndex((x) => x.uid === opts[k].uid);
              if (at >= 0) removeAt(at); else add(opts[k]);
            }
          } else if (e.code === 'Backspace') {
            e.preventDefault();
            if (seq.length) removeAt(seq.length - 1);
          } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            confirm();
          }
        };
        window.addEventListener('keydown', onKey);
        peek.onclick = () => { open = !open; render(); };
        undo.onclick = () => { if (seq.length) removeAt(seq.length - 1); };
        go.onclick = confirm;
        render();
      });
    }

    /* ================= rivelazione, registro, bonus ================= */

    function revealSide(el, seq, i, misfire) {
      el.replaceChildren();
      el.style.setProperty('--tc', colors[i]);
      el.append(node('span', 'reveal-who', factions[i].name));
      const line = node('span', 'reveal-seq');
      if (!seq.length) line.append(node('em', 'reveal-none', 'solo presa'));
      seq.forEach((c, k) => {
        if (k) line.append(node('span', 'reveal-arrow', '→'));
        const s = node('strong', misfire[k] ? 'is-misfire' : null, nameOf(c) + (misfire[k] ? '½' : ''));
        if (misfire[k]) s.title = 'la squadra segue a metà';
        line.append(s);
      });
      el.append(line);
    }

    function logLine(parts) {
      const li = node('li');
      for (const p of parts) li.append(p);
      const log = $('battuta-log');
      log.append(li);
      log.scrollLeft = log.scrollWidth;
    }

    function logBattuta(rev) {
      const parts = [node('b', null, String(rev.battuta))];
      rev.seqs.forEach((seq, i) => {
        if (i === 1) parts.push(document.createTextNode('|'));
        const s = node('span', null, seq.length
          ? seq.map((c, k) => nameOf(c) + (rev.misfire[i][k] ? '½' : '')).join('·')
          : 'presa');
        s.style.setProperty('--tc', colors[i]);
        parts.push(s);
      });
      logLine(parts);
    }

    function logBonus(i, id) {
      const s = node('span', null, `${factions[i].name}: ${bonusInfo(id).name}`);
      s.style.setProperty('--tc', colors[i]);
      const li = [node('b', 'log-star', '★'), s];
      logLine(li);
    }

    /** Il giocatore umano h sceglie un bonus fra quelli offerti. */
    function chooseBonus(h, offers, k, of) {
      return new Promise((done) => {
        const card = $('bonus-overlay-card');
        // In hotseat il Giocatore 2 siede dall'altra parte: la scelta va girata verso di lui.
        card.classList.toggle('is-flipped', hotseat && h.playerNo === 2);
        $('bonus-overlay-title').textContent = duo
          ? `Bonus per il Giocatore ${h.playerNo}`
          : 'Bonus guadagnato';
        $('bonus-overlay-detail').textContent = `${factions[h.index].name} ha accumulato ${(k + 1) * 4} secondi `
          + 'nella Zona Palio. Scegli un vantaggio: resta per tutto il torneo.'
          + (of > 1 ? ` (${k + 1} di ${of})` : '');
        renderBonusChoice($('bonus-overlay-grid'), offers, (id) => {
          $('bonus-overlay').hidden = true;
          done(id);
        });
        $('bonus-overlay').hidden = false;
      });
    }

    async function settleBonuses() {
      // Prima quelli dell'IA, che sceglie da sola; poi gli umani, uno alla volta.
      const before = session.loadouts.map((l) => l.bonuses.length);
      session.grantAiBonuses();
      session.loadouts.forEach((l, i) => {
        for (const id of l.bonuses.slice(before[i])) logBonus(i, id);
      });
      for (const h of humans) {
        const due = session.pendingBonuses()[h.index];
        for (let k = 0; k < due; k++) {
          const id = await chooseBonus(h, session.offers(h.index), k, due);
          session.grant(h.index, id);
          logBonus(h.index, id);
        }
      }
    }

    /* ================= il ciclo delle battute ================= */

    async function loop() {
      while (!session.over) {
        session.begin();
        showEnergy(els, session.energy);
        $('hud-battuta-n').textContent = session.battuta + 1;
        $('battuta-reveal').hidden = true;

        const chosen = await Promise.all(humans.map((h) => buildSequence(h)));
        const picks = [null, null];
        humans.forEach((h, k) => { picks[h.index] = chosen[k]; });

        const rev = session.reveal(picks);
        revealSide($('reveal-a'), rev.seqs[0], 0, rev.misfire[0]);
        revealSide($('reveal-b'), rev.seqs[1], 1, rev.misfire[1]);
        $('battuta-reveal').hidden = false;
        logBattuta(rev);
        await sleep(REVEAL_MS);

        await new Promise((done) => { running = { runner: session.runner(rev.plans), done }; });
        session.next();
        await settleBonuses();
      }
      endOnTime(m);
      await settleBonuses();
      finish();
    }

    function finish() {
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
