/**
 * Le schermate del Cammino del Palio: la mappa a bivi e la "scena", una
 * pergamena generica per eventi, bottega, allenamento, osteria ed esiti.
 */

import { el, clear, showScreen } from './screens.js';
import { deckList, effectList, bonusCard } from './bonusUI.js';
import { getFaction } from '../data/factions.js';
import { CARD_TYPES } from '../cards/cards.js';
import {
  NODE_INFO, ROWS, LANES, reachable,
} from '../run/map.js';
import { deckGroups } from '../run/cammino.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

/* ============================ stato della run ============================ */

/** Cuori, fiorini e mazzo in una riga. */
export function runStatus(state) {
  const box = el('div', 'run-status-row');
  const hearts = el('span', 'run-hearts');
  hearts.title = 'Cuori: ogni tirata persa ne costa uno';
  for (let k = 0; k < state.maxHearts; k++) {
    hearts.append(el('span', k < state.hearts ? 'heart is-full' : 'heart', k < state.hearts ? '♥' : '♡'));
  }
  const coins = el('span', 'run-coins');
  coins.title = 'Fiorini: si spendono in bottega e negli eventi';
  coins.append(el('b', null, String(state.fiorini)), document.createTextNode(' fiorini'));
  const deck = el('span', 'run-decksize', `${state.loadout.deck.length} carte · ${state.loadout.bonuses.length} bonus`);
  box.append(hearts, coins, deck);
  return box;
}

/* ============================ la mappa ============================ */

const pos = (node) => ({
  x: ((node.lane + 0.5) / LANES) * 100,
  y: 5 + ((ROWS - node.row) / ROWS) * 90,
});

/**
 * Disegna la schermata della mappa.
 * @param {object} state
 * @param {{ onEnter: (id:string) => void }} handlers
 */
export function renderCammino(state, { onEnter }) {
  const me = getFaction(state.factionId);
  const boss = getFaction(state.boss);
  document.documentElement.style.setProperty('--fc', me.color);
  const sub = $('cammino-subtitle');
  clear(sub).append(
    el('span', 'tag-faction', me.name),
    document.createTextNode(' · al Palio ti aspetta '),
    el('strong', null, boss.name),
  );
  sub.querySelector('.tag-faction').style.setProperty('--fc', me.color);
  sub.querySelector('strong').style.color = boss.color;

  clear($('run-status')).append(runStatus(state));
  renderMap(state, onEnter);

  clear($('run-deck')).append(deckList(state.loadout.deck));
  const fx = effectList(state.loadout.bonuses);
  $('run-effects').textContent = fx.length ? fx.join(' · ') : 'Nessun effetto permanente, per ora.';

  const log = clear($('run-log'));
  const lines = state.log.slice(-12).reverse();
  if (!lines.length) log.append(el('li', 'run-log-empty', 'Il cammino comincia dalla prima riga in basso.'));
  for (const l of lines) log.append(el('li', null, l.text));
}

function renderMap(state, onEnter) {
  const map = clear($('map'));
  const open = new Set(state.stage === 'done' ? [] : reachable(state.map, state.pos));
  const visited = new Set(state.visited);
  const all = state.map.rows.flat();

  // I sentieri, sotto le tappe.
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('map-paths');
  const walked = new Set();
  for (let k = 1; k < state.visited.length; k++) walked.add(`${state.visited[k - 1]}>${state.visited[k]}`);
  for (const a of all) {
    for (const id of a.next) {
      const b = all.find((n) => n.id === id);
      const p = pos(a);
      const q = pos(b);
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', p.x); line.setAttribute('y1', p.y);
      line.setAttribute('x2', q.x); line.setAttribute('y2', q.y);
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      let cls = 'path';
      if (walked.has(`${a.id}>${b.id}`)) cls += ' is-walked';
      else if (a.id === state.pos && open.has(b.id)) cls += ' is-open';
      line.setAttribute('class', cls);
      svg.append(line);
    }
  }
  map.append(svg);

  for (const n of all) {
    const info = NODE_INFO[n.type];
    const p = pos(n);
    const btn = el('button', `map-node node-${n.type}`);
    btn.type = 'button';
    btn.style.left = `${p.x}%`;
    btn.style.top = `${p.y}%`;
    btn.dataset.id = n.id;
    btn.dataset.type = n.type;
    const opp = n.opp ? getFaction(n.opp) : null;
    if (opp) btn.style.setProperty('--oc', opp.color);
    btn.append(el('span', 'node-icon', info.icon));
    const label = el('span', 'node-label', opp && n.type !== 'palio' ? opp.name : info.name);
    btn.append(label);
    btn.title = opp ? `${info.name} contro ${opp.name} — ${info.text}` : `${info.name} — ${info.text}`;
    if (visited.has(n.id)) btn.classList.add('is-visited');
    if (n.id === state.pos) btn.classList.add('is-here');
    if (open.has(n.id)) {
      btn.classList.add('is-open');
      btn.addEventListener('click', () => onEnter(n.id));
    } else {
      btn.disabled = true;
    }
    map.append(btn);
  }
  // Sul telefono la mappa è più alta dello schermo: si porta in vista la prossima tappa.
  requestAnimationFrame(() => {
    const next = map.querySelector('.map-node.is-open');
    if (!next) return;
    const r = next.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) next.scrollIntoView({ block: 'center' });
  });
  $('map-hint').textContent = state.stage === 'done'
    ? 'Il cammino è concluso.'
    : 'Scegli la prossima tappa: si sale solo lungo i sentieri.';
}

/* ============================ la scena ============================ */

/**
 * Mostra una pergamena con titolo, racconto, contenuto e pulsanti.
 * @param {object} o
 * @param {string} [o.kicker]   riga piccola sopra il titolo
 * @param {string} o.title
 * @param {string} [o.text]
 * @param {string} [o.seal]     simbolo nel sigillo
 * @param {string} [o.color]    colore del sigillo
 * @param {Node[]} [o.body]
 * @param {Array<{label:string, detail?:string, primary?:boolean, disabled?:boolean, onClick:Function}>} [o.actions]
 */
export function showScene({
  kicker = '', title, text = '', seal = '✠', color = null, body = [], actions = [],
}) {
  $('scene-kicker').textContent = kicker;
  $('scene-title').textContent = title;
  $('scene-text').textContent = text;
  $('scene-text').hidden = !text;
  const s = $('scene-seal');
  s.textContent = seal;
  s.style.setProperty('--sc', color ?? 'var(--wax)');
  clear($('scene-body')).append(...body);
  clear($('scene-actions')).append(...actions.map((a) => {
    const b = el('button', `btn ${a.primary ? 'btn-primary' : ''} scene-choice`);
    b.type = 'button';
    b.append(el('strong', null, a.label));
    if (a.detail) b.append(el('span', 'scene-choice-detail', a.detail));
    b.disabled = !!a.disabled;
    if (a.disabled && a.why) b.title = a.why;
    b.addEventListener('click', () => a.onClick());
    return b;
  }));
  showScreen('scene');
}

/** Le carte del mazzo come pulsanti: per togliere o raddoppiare. */
export function deckPicker(loadout, onPick, { verb = 'Scegli' } = {}) {
  const box = el('div', 'deck-picker');
  for (const { type, n } of deckGroups(loadout)) {
    const t = CARD_TYPES[type];
    const b = el('button', `deck-pick card-${t.kind}`);
    b.type = 'button';
    b.dataset.type = type;
    b.title = `${verb}: ${t.name} — ${t.text}`;
    b.append(
      el('strong', null, t.name),
      el('span', 'deck-pick-meta', `${t.cost}⚡ · ${t.dur} s`),
      el('span', 'deck-pick-n', `×${n}`),
    );
    b.addEventListener('click', () => onPick(type));
    box.append(b);
  }
  return box;
}

/** Tre bonus da scegliere, nella scena. */
export function bonusPicker(offers, onPick) {
  const box = el('div', 'bonus-grid scene-bonus');
  box.append(...offers.map((id) => bonusCard(id, onPick)));
  return box;
}

/** Il mazzo e gli effetti di un avversario, per prepararsi alla tirata. */
export function opponentSheet(loadout) {
  const box = el('div', 'opp-sheet');
  box.append(el('h2', 'panel-title', 'Il suo mazzo'), deckList(loadout.deck));
  const fx = effectList(loadout.bonuses);
  box.append(el('p', 'squad-effects', fx.length ? `Effetti: ${fx.join(' · ')}` : 'Nessun effetto permanente.'));
  return box;
}
