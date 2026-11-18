/**
 * Pezzi condivisi della tirata giocata: la squadra pronta per il motore, l'HUD
 * (nomi, tenuta, cronometro, giostra) e la schermata d'esito.
 *
 * La tirata vera e propria, a carte, sta in ../cards/cardMatch.js.
 */

import {
  teamDistance, TUNING, giriAlMinuto, sogliaSicura, sottoChance, makeTeam,
} from './engine.js';
import { BASE_ROSTER } from '../core/roster.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

/**
 * La squadra pronta per il motore. Tutte le squadre scendono in campo con la
 * stessa formazione: a distinguerle sono le carte e i bonus, non i tiratori.
 */
export function buildTeam(factionId) {
  return makeTeam(factionId, BASE_ROSTER, null);
}

/**
 * HUD statico della tirata: nomi, marcatori dei giocatori, colori, obiettivo.
 * Condiviso fra la tirata in tempo reale e quella a carte.
 * @param {object} cfg
 * @param {Array} cfg.factions   i due quartieri, [casa, trasferta]
 * @param {string[]} cfg.colors
 * @param {Array<{index:number}>} cfg.humans  il lato umano, se c'è
 * @param {number} cfg.hold      secondi di tenuta richiesti
 * @param {string} [cfg.title]
 * @returns {object} gli elementi dell'HUD dinamico, per `updateHud`
 */
export function prepareHud({
  factions, colors, humans, hold, title,
}) {
  // Il quartiere del giocatore va riconosciuto a colpo d'occhio: i due nomi
  // sono simmetrici e senza marcatore si chiama la tirata per l'avversario.
  // Il marcatore è un elemento a sé e non un suffisso del nome, altrimenti su
  // schermo stretto è proprio lui a finire nei puntini di sospensione.
  $('hud-name-a').textContent = factions[0].name;
  $('hud-name-b').textContent = factions[1].name;
  $('hud-you-a').hidden = true;
  $('hud-you-b').hidden = true;
  for (const h of humans) {
    const badge = h.index === 0 ? $('hud-you-a') : $('hud-you-b');
    badge.hidden = false;
    badge.textContent = 'tu';
  }
  $('hud-you-a').style.setProperty('--tc', colors[0]);
  $('hud-you-b').style.setProperty('--tc', colors[1]);
  $('hud-name-a').style.setProperty('--tc', colors[0]);
  $('hud-name-b').style.setProperty('--tc', colors[1]);
  $('hud-hold-target').textContent = hold;
  $('match-overlay').hidden = true;
  $('pause-overlay').hidden = true;
  if (title) document.title = `${title} — Palio del Timone`;

  const els = {
    time: $('hud-time'),
    edge: $('hud-edge'),
    holdFill: [$('hold-fill-a'), $('hold-fill-b')],
    holdText: [$('hold-text-a'), $('hold-text-b')],
    energy: [$('hud-energy-a'), $('hud-energy-b')],
  };
  els.holdFill[0].style.background = `linear-gradient(90deg, ${hexA(colors[0], 0.45)}, ${colors[0]})`;
  els.holdFill[1].style.background = `linear-gradient(270deg, ${hexA(colors[1], 0.45)}, ${colors[1]})`;
  return els;
}

/* ---------------- HUD ---------------- */

/** Energia disponibile di ciascuna squadra in questa battuta, come pallini. */
export function showEnergy(els, energy) {
  energy.forEach((n, i) => {
    const el = els.energy[i];
    if (!el) return;
    el.textContent = `${'⚡'.repeat(Math.max(0, Math.min(n, 9)))}`;
    el.title = `${n} energia in questa battuta`;
    el.dataset.n = n;
  });
}

export function updateHud(m, els, preset, factions, colors) {
  const left = Math.max(0, preset.duration - m.time);
  els.time.textContent = formatTime(left);
  els.time.classList.toggle('is-urgent', left <= 10);

  for (let i = 0; i < 2; i++) {
    const rt = m.rt[i];
    els.holdFill[i].style.width = `${Math.min(100, (rt.hold / preset.hold) * 100)}%`;
    els.holdText[i].textContent = `${rt.hold.toFixed(1)}s`;
  }

  // Negli ultimi secondi conta chi ha il palo più vicino: mostralo.
  if (left <= 12) {
    const dA = teamDistance(m, 0) / DEG;
    const dB = teamDistance(m, 1) / DEG;
    const leadIdx = dA <= dB ? 0 : 1;
    els.edge.innerHTML = `vantaggio <b>${factions[leadIdx].name}</b> · ${Math.min(dA, dB).toFixed(0)}°`;
    els.edge.style.setProperty('--ec', colors[leadIdx]);
  } else {
    els.edge.textContent = '';
  }
}

/**
 * Velocità della giostra e sua leggibilità tattica. È l'informazione che
 * governa il sotto: sotto la soglia verde il passaggio riesce sempre, sopra
 * diventa una scommessa sull'Agilità e sul Gioco di squadra della rosa.
 *
 * Con `focusIndex` la lettura è quella di una squadra precisa — la sua
 * probabilità di sotto adesso. A `null` (due umani sullo stesso schermo) resta
 * neutra sulla velocità: la soglia è la stessa per tutti, la chance no.
 */
export function updateGiostra(m, focusIndex) {
  const rpm = giriAlMinuto(m.omega);
  const soglia = sogliaSicura();
  const scala = giriAlMinuto(TUNING.SOTTO_WILD_OMEGA);

  const pct = (v) => `${Math.min(100, (v / scala) * 100)}%`;
  $('giostra-fill').style.width = pct(rpm);
  $('giostra-safe').style.width = pct(soglia);
  $('giostra-mark').style.left = pct(soglia);
  $('giostra-rpm').textContent = rpm.toFixed(1);

  const el = $('giostra-state');

  if (focusIndex == null) {
    // Neutro: la sola velocità, senza attribuire una chance a una delle due.
    const safe = rpm <= soglia;
    const wild = rpm > soglia * 1.8;
    el.classList.toggle('is-safe', safe);
    el.classList.toggle('is-risky', !safe && !wild);
    el.classList.toggle('is-wild', wild);
    el.textContent = safe ? `sotto sicuro · fino a ${soglia.toFixed(1)}` : 'giostra lanciata';
    return;
  }

  const chance = sottoChance(m, focusIndex);
  el.classList.toggle('is-safe', chance >= 0.999);
  el.classList.toggle('is-risky', chance < 0.999 && chance >= 0.45);
  el.classList.toggle('is-wild', chance < 0.45);
  el.textContent = chance >= 0.999
    ? `sotto sicuro · fino a ${soglia.toFixed(1)}`
    : `sotto al ${Math.round(chance * 100)}%`;
}

export function showOutcome(m, factions, humans, onContinue) {
  const overlay = $('match-overlay');
  const { winnerIndex, reason } = m.outcome;

  const titleEl = $('overlay-title');
  const detailEl = $('overlay-detail');

  if (winnerIndex === null) {
    titleEl.textContent = 'Tirata pari';
    titleEl.style.setProperty('--oc', 'var(--ink)');
  } else {
    const won = winnerIndex === (humans[0]?.index ?? 0);
    titleEl.textContent = won ? 'Tirata vinta!' : 'Tirata persa';
    titleEl.style.setProperty('--oc', won ? factions[winnerIndex].color : 'var(--ink-dim)');
  }

  const detail = reason === 'hold'
    ? `${factions[winnerIndex].name} tiene il palo in zona per ${m.preset.hold} secondi.`
    : reason === 'proximity'
      ? `Tempo scaduto: ${factions[winnerIndex].name} chiude col palo più vicino alla Zona Palio `
        + `(${m.outcome[winnerIndex === 0 ? 'proximityHome' : 'proximityAway'].toFixed(0)}° contro `
        + `${m.outcome[winnerIndex === 0 ? 'proximityAway' : 'proximityHome'].toFixed(0)}°).`
      : 'Tempo scaduto con i due pali perfettamente equidistanti.';
  detailEl.textContent = detail;

  overlay.hidden = false;
  const btn = $('btn-overlay-continue');
  const handler = () => {
    btn.removeEventListener('click', handler);
    overlay.hidden = true;
    onContinue();
  };
  btn.addEventListener('click', handler);
}

function formatTime(sec) {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Converte #rrggbb in rgba con alpha. */
export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

