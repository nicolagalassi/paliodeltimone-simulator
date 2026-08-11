/** Schermata di draft: pool, budget peso, rosa selezionata. */

import { el, clear } from './screens.js';
import { STATS, STAT_SHORT, STAT_LABEL, getFaction } from '../data/factions.js';
import {
  WEIGHT_CAP, ROSTER_SIZE, canAdd, validateRoster, teamStats, autoFill,
} from '../core/roster.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {object} cfg
 * @param {Array} cfg.pool
 * @param {string} cfg.factionId
 * @param {number|null} [cfg.playerNo]  1 o 2 nel torneo a due, per intitolare la
 *   schermata al giocatore giusto; `null`/assente a giocatore singolo.
 * @param {(roster:Array)=>void} cfg.onConfirm
 */
export function mountRoster({ pool, factionId, playerNo = null, onConfirm }) {
  let roster = [];
  const faction = getFaction(factionId);
  document.documentElement.style.setProperty('--fc', faction.color);

  // In coppia si compongono due rose di fila: l'intestazione dice a chi tocca e
  // con quale quartiere, così non ci si confonde fra un draft e l'altro.
  $('roster-title').textContent = playerNo
    ? `Giocatore ${playerNo} · ${faction.name}`
    : 'Componi la rosa';

  const poolGrid = $('pool-grid');
  const pickedList = $('picked-list');

  function toggle(shooter) {
    const idx = roster.findIndex((s) => s.id === shooter.id);
    if (idx >= 0) roster.splice(idx, 1);
    else if (canAdd(roster, shooter)) roster.push(shooter);
    render();
  }

  function render() {
    renderPool();
    renderPicked();
    renderBudget();
  }

  function renderPool() {
    clear(poolGrid);
    for (const s of pool) {
      const picked = roster.some((r) => r.id === s.id);
      const btn = el('button', 'shooter');
      btn.type = 'button';
      btn.classList.toggle('is-picked', picked);
      btn.disabled = !picked && !canAdd(roster, s, pool);
      btn.title = picked
        ? 'Togli dalla rosa'
        : btn.disabled ? 'Non entra nel budget peso' : 'Aggiungi alla rosa';

      const top = el('div', 'shooter-top');
      top.append(el('span', 'shooter-name', s.name), el('span', 'shooter-kg', `${s.weight} kg`));
      btn.append(top, statsBlock(s.stats, faction.bonusStat));
      btn.addEventListener('click', () => toggle(s));
      poolGrid.append(btn);
    }
  }

  function renderPicked() {
    clear(pickedList);
    if (!roster.length) {
      pickedList.append(el('p', 'picked-empty', 'Nessun tiratore selezionato.'));
    }
    for (const s of roster) {
      const row = el('div', 'picked-row');
      row.append(el('span', null, s.name), el('span', null, `${s.weight} kg`));
      const rm = el('button', null, '×');
      rm.type = 'button';
      rm.title = 'Rimuovi';
      rm.addEventListener('click', () => toggle(s));
      row.append(rm);
      pickedList.append(row);
    }
    renderAverages();
  }

  function renderAverages() {
    const box = clear($('team-averages'));
    if (!roster.length) return;
    const t = teamStats(roster, factionId);
    for (const key of STATS) {
      const row = el('div');
      const label = el('span', null, STAT_LABEL[key]);
      if (key === faction.bonusStat) label.append(el('span', 'bonus-flag', ' +10%'));
      row.append(label, el('b', null, t[key].toFixed(0)));
      box.append(row);
    }
    const w = el('div');
    w.append(el('span', null, 'Peso medio'), el('b', null, `${t.avgWeight.toFixed(0)} kg`));
    box.append(w);
  }

  function renderBudget() {
    const { kg, ok, overWeight } = validateRoster(roster);
    $('budget-kg').textContent = kg;
    $('budget-picked').textContent = roster.length;
    $('budget-fill').style.width = `${Math.min(100, (kg / WEIGHT_CAP) * 100)}%`;
    $('budget-fill').parentElement.classList.toggle('is-over', overWeight);
    $('btn-roster-confirm').disabled = !ok;
    $('btn-roster-confirm').textContent = roster.length < ROSTER_SIZE
      ? `Scegli ancora ${ROSTER_SIZE - roster.length}`
      : 'Inizia il torneo';
  }

  $('btn-roster-auto').onclick = () => { roster = autoFill(pool, factionId, roster); render(); };
  $('btn-roster-clear').onclick = () => { roster = []; render(); };
  $('btn-roster-confirm').onclick = () => {
    if (validateRoster(roster).ok) onConfirm(roster.slice());
  };

  render();
}

function statsBlock(stats, bonusStat) {
  const grid = el('div', 'shooter-stats');
  for (const key of STATS) {
    const cell = el('div', 'stat');
    const label = el('span', 'stat-label', STAT_SHORT[key] + (key === bonusStat ? '+' : ''));
    const bar = el('div', 'stat-bar');
    const fill = el('i');
    fill.style.width = `${Math.min(100, stats[key])}%`;
    if (key === bonusStat) fill.style.background = 'var(--fc)';
    bar.append(fill);
    cell.append(label, bar, el('span', 'stat-val', stats[key]));
    grid.append(cell);
  }
  return grid;
}
