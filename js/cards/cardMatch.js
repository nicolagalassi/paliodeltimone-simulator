/**
 * La tirata a carte giocata.
 *
 * A ogni battuta il ciclo è sempre lo stesso:
 *   1. si pesca, si ricarica l'energia, e l'IA sceglie la sua sequenza — coperta;
 *   2. ogni Chiamatore umano mette in fila le sue carte, entro energia e tempo;
 *   3. le sequenze si scoprono insieme (e si vede se qualche chiamata esce a metà),
 *      una sopra l'altra e allineate secondo per secondo: il "duello";
 *   4. il motore gioca i cinque secondi della battuta, animati sul campo, mentre
 *      un cursore scorre sul duello e accende la carta che ciascuno sta giocando;
 *      finita la battuta il duello resta lì, con i gradi guadagnati o persi, per
 *      tutta la scelta della battuta dopo.
 *   5. chi ha accumulato abbastanza secondi in zona sceglie un bonus.
 *
 * Nessuno vede le carte dell'altro prima di aver chiamato le proprie: è questo,
 * e non i riflessi, che decide la tirata.
 */

import { getFaction } from '../data/factions.js';
import { endOnTime, teamDistance } from '../match/engine.js';
import { createRenderer } from '../match/renderer.js';
import {
  prepareHud, updateHud, updateGiostra, showOutcome, showEnergy,
} from '../match/match.js';
import {
  CARD_TYPES, BATTUTA_SECONDS, COMBOS, comboOf, cardEffect, cardTowardGoal, whyNot, seqCost, seqDur,
} from './cards.js';
import { bonusInfo } from './bonus.js';
import { createCardSession, toResult } from './cardSim.js';
import { renderBonusChoice } from '../ui/bonusUI.js';

const $ = (id) => document.getElementById(id);

/**
 * La battuta scorre al tempo vero, per seguirla carta per carta; "avanti
 * veloce" la fa scorrere al doppio, per chi ha già capito come va a finire.
 */
const PLAYBACK_SPEED = 1;
const FAST_SPEED = 2.2;
/** Quanto restano scoperte le due sequenze, ferme, prima che parta la battuta. */
const REVEAL_MS = 1100;
/** L'avanti veloce resta acceso da una tirata all'altra. */
let fast = false;
const DEG = 180 / Math.PI;

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
 * @param {Array<{type:'ai'}|{type:'human'}>} cfg.controllers  [casa, trasferta]: un solo lato umano
 * @param {number} cfg.battute
 * @param {number} cfg.hold
 * @param {number|string} cfg.seed
 * @param {string} [cfg.title]
 * @returns {Promise<object>} risultato orientato home/away
 */
export function playCardMatch({
  homeTeam, awayTeam, loadouts, controllers, battute, hold, seed, title,
}) {
  return new Promise((resolve) => {
    const session = createCardSession({
      homeTeam, awayTeam, loadouts, battute, hold, seed,
      ai: controllers.map((c) => c.type !== 'human'),
    });
    const { m } = session;
    const factions = [getFaction(homeTeam.factionId), getFaction(awayTeam.factionId)];
    const colors = factions.map((f) => f.color);

    // Il lato umano (al più uno): la sua mano sta in basso, nel pannello "a".
    const humans = [];
    controllers.forEach((c, i) => {
      if (c.type === 'human' && !humans.length) humans.push({ index: i, side: 'a' });
    });

    /* ---- la schermata ---- */
    $('hud-battuta-tot').textContent = battute;
    $('bonus-overlay').hidden = true;
    $('battuta-info').hidden = true;
    $('battuta-log').replaceChildren();
    $('hand-player-a').hidden = !humans.length;
    $('hand-label-a').textContent = 'La tua mano';

    const els = prepareHud({
      factions, colors, humans, hold, title,
    });
    const renderer = createRenderer($('field'));
    const duel = createDuel();
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
      if (running && !paused) {
        const over = running.runner.advance(dt * (fast ? FAST_SPEED : PLAYBACK_SPEED));
        duel.progress(running.runner.progress);
        if (over) {
          const { done } = running;
          running = null;
          done();
        }
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
    const fastBtn = $('btn-fast');
    const setFast = (v) => {
      fast = v;
      fastBtn.classList.toggle('is-on', v);
      fastBtn.setAttribute('aria-pressed', String(v));
    };
    setFast(fast);
    fastBtn.onclick = () => setFast(!fast);
    $('btn-resume').onclick = () => setPaused(false);
    const onPauseKey = (e) => {
      if (e.code === 'KeyF') { e.preventDefault(); setFast(!fast); return; }
      if (e.code !== 'KeyP' && e.code !== 'Escape') return;
      e.preventDefault();
      setPaused(!paused);
    };
    window.addEventListener('keydown', onPauseKey);

    /* ================= la mano e la sequenza ================= */

    function cardButton(card, h, { order = 0, reason = null }) {
      const t = CARD_TYPES[card.type];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card card-${t.kind}`;
      btn.dataset.type = card.type;
      btn.title = t.text + (reason ? ` — ${reason}` : '');
      btn.append(
        node('span', 'card-cost', `${t.cost}⚡`),
        node('span', 'card-dur', `${t.dur} s`),
        node('strong', 'card-name', t.name),
        node('em', 'card-effect', cardEffect(card, session.battutaMods[h.index])),
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
      const combos = comboOf(seq);
      const blocks = seq.map((c, k) => {
        const t = CARD_TYPES[c.type];
        const b = node('button', `tl-block card-${t.kind}`, t.name);
        b.type = 'button';
        b.style.flexGrow = t.dur;
        b.title = `${t.name} · ${t.dur} s — tocca per toglierla`;
        if (combos[k]) {
          const co = COMBOS[combos[k]];
          b.classList.add('has-combo');
          b.append(node('span', 'tl-combo', `${co.name} +${Math.round((co.mult - 1) * 100)}%`));
          b.title += ` · combo ${co.name}`;
        }
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
        const undo = $(`hand-undo-${h.side}`);
        const go = $(`hand-go-${h.side}`);
        let seq = [];

        const add = (c) => { if (!whyNot(seq, c, energy)) { seq = [...seq, c]; render(); } };
        const removeAt = (k) => { seq = seq.filter((_, j) => j !== k); render(); };

        function render() {
          box.replaceChildren(...opts.map((c, k) => {
            const at = seq.findIndex((x) => x.uid === c.uid);
            const reason = at >= 0 ? null : whyNot(seq, c, energy);
            const b = cardButton(c, h, { order: at + 1, reason });
            if (k < 9) b.append(node('span', 'card-key', String(k + 1)));
            b.addEventListener('click', () => (at >= 0 ? removeAt(at) : add(c)));
            return b;
          }));
          renderEnergy(h, seq);
          renderTimeline(h, seq, removeAt);
          undo.hidden = false;
          undo.disabled = !seq.length;
          go.hidden = false;
          go.disabled = false;
          go.textContent = seq.length ? 'Chiama' : 'Chiama: solo presa';
          status.textContent = 'metti in fila le carte';
          status.classList.remove('is-ready');
        }

        function confirm() {
          window.removeEventListener('keydown', onKey);
          undo.onclick = null;
          go.onclick = null;
          undo.hidden = true;
          go.hidden = true;
          box.replaceChildren(...opts.map((c) => {
            const at = seq.findIndex((x) => x.uid === c.uid);
            const b = cardButton(c, h, { order: at + 1 });
            b.disabled = true;
            return b;
          }));
          renderTimeline(h, seq, null);
          status.textContent = `hai chiamato ${seq.length ? seq.map(nameOf).join(' → ') : 'solo presa'}`;
          status.classList.add('is-ready');
          done(seq);
        }

        const onKey = (e) => {
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
        undo.onclick = () => { if (seq.length) removeAt(seq.length - 1); };
        go.onclick = confirm;
        render();
      });
    }

    /* ================= rivelazione, registro, bonus ================= */

    /**
     * Il duello: le due sequenze scoperte, una riga per squadra, sulla stessa
     * scala dei cinque secondi. Così si vede che cosa si scontra con che cosa —
     * la mia Spinta contro la sua Tirata nel secondo 2 — e, a fine battuta,
     * quanto ha reso: i gradi di cui ciascuno ha avvicinato (o allontanato) il
     * proprio palo all'arco.
     */
    function createDuel() {
      const root = $('duel');
      const sides = ['a', 'b'];
      let segs = [[], []];
      let before = [0, 0];

      sides.forEach((x, i) => {
        const who = $(`duel-who-${x}`);
        const h = humans.find((u) => u.index === i);
        who.replaceChildren(factions[i].name);
        if (h) who.append(node('span', 'duel-you', ' (tu)'));
        who.style.setProperty('--tc', colors[i]);
        $(`duel-track-${x}`).replaceChildren();
        $(`duel-delta-${x}`).textContent = '';
        $(`duel-delta-${x}`).className = 'duel-delta';
      });
      $('duel-title').textContent = 'Le chiamate';
      $('duel-note').textContent = 'si scoprono qui, una sopra l\'altra, secondo per secondo';
      root.classList.add('is-idle');

      function head(title, note) {
        $('duel-title').textContent = title;
        $('duel-note').textContent = note;
      }

      /** Mette in pista le sequenze appena scoperte; il cursore torna a zero. */
      function show(rev) {
        before = [0, 1].map((i) => teamDistance(m, i));
        segs = rev.seqs.map((seq, i) => {
          const track = $(`duel-track-${sides[i]}`);
          const out = [];
          let at = 0;
          const combos = comboOf(seq);
          seq.forEach((c, k) => {
            const t = CARD_TYPES[c.type];
            const half = rev.misfire[i][k];
            const el = node('span', `duel-block card-${t.kind}${half ? ' is-misfire' : ''}`, t.name + (half ? ' ½' : ''));
            el.style.flexGrow = t.dur;
            el.title = `${t.name} · ${t.dur} s${half ? ' — eseguita a metà' : ''}`;
            if (combos[k]) {
              el.classList.add('has-combo');
              el.title += ` · combo ${COMBOS[combos[k]].name}`;
            }
            out.push({
              el, start: at, end: at + t.dur, react: t.kind === 'react', side: i,
            });
            at += t.dur;
          });
          if (at < BATTUTA_SECONDS - 1e-9) {
            const el = node('span', 'duel-block is-free', seq.length ? 'presa' : 'solo presa');
            el.style.flexGrow = BATTUTA_SECONDS - at;
            el.title = 'presa passiva: la squadra tiene ma non spinge';
            out.push({ el, start: at, end: BATTUTA_SECONDS });
          }
          track.replaceChildren(...out.map((g) => g.el));
          const d = $(`duel-delta-${sides[i]}`);
          d.textContent = '';
          d.className = 'duel-delta';
          return out;
        });
        root.classList.remove('is-idle');
        head(`Battuta ${rev.battuta}`, rev.misfire.some((f) => f.some(Boolean))
          ? 'scoperte · ½ = la squadra segue a metà'
          : 'scoperte · ecco che cosa ha chiamato ciascuno');
        progress(0);
      }

      /** Il cursore a `p` (0…1 della battuta): accende la carta in corso e aggiorna i gradi. */
      function progress(p) {
        const t = p * BATTUTA_SECONDS;
        $('duel-playhead').style.setProperty('--p', p.toFixed(4));
        for (const out of segs) {
          for (const g of out) {
            const now = p > 0 && p < 1 && t >= g.start && t < g.end;
            g.el.classList.toggle('is-now', now);
            g.el.classList.toggle('is-past', p >= 1 || t >= g.end);
            // Una risposta che coglie nel segno resta segnata.
            if (now && g.react && m.rt[g.side].react === 'hit') g.el.classList.add('is-hit');
          }
        }
        if (p > 0) deltas();
      }

      function deltas() {
        [0, 1].forEach((i) => {
          const d = $(`duel-delta-${sides[i]}`);
          const now = teamDistance(m, i);
          if (now <= 0) {
            d.textContent = 'in zona';
            d.className = 'duel-delta is-zone';
            d.title = 'il palo è nell\'arco della Zona Palio';
            return;
          }
          const gain = (before[i] - now) * DEG;
          const r = Math.round(gain);
          d.textContent = r === 0 ? '±0°' : `${r > 0 ? '+' : '−'}${Math.abs(r)}°`;
          d.className = `duel-delta${r > 0 ? ' is-gain' : r < 0 ? ' is-loss' : ''}`;
          d.title = `${r >= 0 ? 'avvicinato' : 'allontanato'} di ${Math.abs(r)}° il proprio palo alla Zona Palio`
            + ` · ora a ${Math.round(now * DEG)}°`;
        });
      }

      /** Battuta giocata: il duello resta in vista mentre si sceglie la prossima. */
      function settle(n) {
        progress(1);
        head(`Battuta ${n} · com'è andata`, 'gradi verso la Zona Palio · resta qui mentre scegli');
      }

      return { show, progress, settle };
    }

    /**
     * Ciò che si sa prima di chiamare: l'intenzione dell'IA (la sua prima
     * carta) e l'imprevisto della battuta.
     */
    function renderInfo() {
      const box = $('battuta-info');
      const parts = [];
      for (const h of humans) {
        const opp = 1 - h.index;
        const it = session.intent(opp);
        if (it === undefined) continue;
        const p = node('span', 'info-intent');
        p.style.setProperty('--tc', colors[opp]);
        p.append(node('b', null, factions[opp].name), document.createTextNode(' apre con '));
        if (it) {
          const t = CARD_TYPES[it];
          p.append(node('strong', `info-card card-${t.kind}`, t.name));
        } else {
          p.append(node('strong', 'info-card', 'presa'));
        }
        p.title = 'L’intenzione dell’avversario: la prima carta della sequenza che ha già chiamato.';
        parts.push(p);
      }
      const imp = session.imprevisto;
      if (imp) {
        const p = node('span', 'info-imprevisto');
        p.append(node('b', null, imp.name), document.createTextNode(` — ${imp.text}`));
        parts.push(p);
      }
      box.replaceChildren(...parts);
      box.hidden = !parts.length;
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
        $('bonus-overlay-title').textContent = 'Bonus guadagnato';
        $('bonus-overlay-detail').textContent = `${factions[h.index].name} ha accumulato ${(k + 1) * 4} secondi `
          + 'nella Zona Palio. Scegli un vantaggio: resta fino al Palio.'
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
        renderInfo();
        showEnergy(els, session.energy);
        $('hud-battuta-n').textContent = session.battuta + 1;

        const chosen = await Promise.all(humans.map((h) => buildSequence(h)));
        const picks = [null, null];
        humans.forEach((h, k) => { picks[h.index] = chosen[k]; });

        const rev = session.reveal(picks);
        duel.show(rev);
        logBattuta(rev);
        await sleep(fast ? REVEAL_MS / 2 : REVEAL_MS);

        await new Promise((done) => { running = { runner: session.runner(rev.plans), done }; });
        duel.settle(rev.battuta);
        session.next();
        await settleBonuses();
      }
      endOnTime(m);
      await settleBonuses();
      finish();
    }

    function finish() {
      showOutcome(m, factions, humans, () => {
        cancelAnimationFrame(raf);
        renderer.destroy();
        window.removeEventListener('keydown', onPauseKey);
        document.title = 'Palio del Timone — Simulatore';
        resolve(toResult(m.outcome));
      });
    }

    loop();
  });
}
