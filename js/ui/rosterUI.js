/** Draft della formazione: si scelgono due tiratori per posizione, in sequenza. */

import { el, clear } from './screens.js';
import { STATS, STAT_SHORT, STAT_LABEL, getFaction } from '../data/factions.js';
import {
  ROLES, ROLE_IDS, PER_ROLE, WEIGHT_CAP, teamStats, bestForRole,
  canAddToFormation, validateFormation, totalWeight,
} from '../core/roster.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {object} cfg
 * @param {{esterno:Array,mediano:Array,interno:Array}} cfg.pool  pool per posizione
 * @param {string} cfg.factionId
 * @param {number|null} [cfg.playerNo]  1 o 2 nel torneo a due; `null` a singolo.
 * @param {(roster:Array)=>void} cfg.onConfirm
 */
export function mountRoster({ pool, factionId, playerNo = null, onConfirm }) {
  const faction = getFaction(factionId);
  document.documentElement.style.setProperty('--fc', faction.color);

  let stepIdx = 0;                                   // 0=Esterni, 1=Mediani, 2=Interni
  const picks = Object.fromEntries(ROLE_IDS.map((r) => [r, []]));

  const role = () => ROLES[stepIdx];
  const currentPicks = () => picks[role().id];
  const fullRoster = () => ROLE_IDS.flatMap((r) => picks[r]);
  const isLast = () => stepIdx === ROLES.length - 1;

  // In coppia si compongono due formazioni di fila: l'intestazione dice a chi
  // tocca e con quale quartiere.
  $('roster-title').textContent = playerNo
    ? `Giocatore ${playerNo} · ${faction.name}`
    : 'Componi la formazione';

  function toggle(shooter) {
    const arr = picks[shooter.role];
    const idx = arr.findIndex((s) => s.id === shooter.id);
    if (idx >= 0) arr.splice(idx, 1);
    else if (arr.length < PER_ROLE && canAddToFormation(pool, picks, shooter)) arr.push(shooter);
    render();
  }

  function render() {
    renderSteps();
    renderPool();
    renderFormation();
    renderBudget();
    renderAverages();
    renderControls();
  }

  /* --- barra di avanzamento fra le tre posizioni --- */
  function renderSteps() {
    const box = clear($('formation-steps'));
    ROLES.forEach((r, i) => {
      const done = picks[r.id].length === PER_ROLE;
      const chip = el('button', 'formation-step');
      chip.type = 'button';
      chip.classList.toggle('is-current', i === stepIdx);
      chip.classList.toggle('is-done', done && i !== stepIdx);
      chip.append(
        el('span', 'formation-step-name', r.label),
        el('span', 'formation-step-count', `${picks[r.id].length}/${PER_ROLE}`),
      );
      // Si torna a una posizione già affrontata; non si salta avanti a vuoto.
      if (i <= stepIdx || picks[ROLE_IDS[i - 1]]?.length === PER_ROLE) {
        chip.addEventListener('click', () => { stepIdx = i; render(); });
      } else {
        chip.disabled = true;
      }
      box.append(chip);
    });
  }

  /* --- candidati della posizione corrente --- */
  function renderPool() {
    const r = role();
    $('pool-title').textContent = `${r.label} · scegline ${PER_ROLE}`;
    $('pool-hint').textContent = r.blurb;

    const grid = clear($('pool-grid'));
    const full = currentPicks().length >= PER_ROLE;
    for (const s of pool[r.id]) {
      const picked = currentPicks().some((p) => p.id === s.id);
      const fits = picked || (!full && canAddToFormation(pool, picks, s));
      const btn = el('button', 'shooter');
      btn.type = 'button';
      btn.classList.toggle('is-picked', picked);
      btn.disabled = !picked && !fits;
      btn.title = picked ? 'Togli dalla formazione'
        : full ? `Hai già scelto ${PER_ROLE} ${r.label.toLowerCase()}`
          : !fits ? 'Non entra nel tetto dei 540 kg' : 'Aggiungi';

      const top = el('div', 'shooter-top');
      top.append(el('span', 'shooter-name', s.name), el('span', 'shooter-kg', `${s.weight} kg`));
      btn.append(top, statsBlock(s.stats, faction.bonusStat));
      btn.addEventListener('click', () => toggle(s));
      grid.append(btn);
    }
  }

  /* --- formazione scelta, posizione per posizione --- */
  function renderFormation() {
    const box = clear($('formation-list'));
    for (const r of ROLES) {
      const group = el('div', 'formation-group');
      group.classList.toggle('is-current', r.id === role().id);
      const head = el('div', 'formation-group-head');
      head.append(el('span', 'formation-role', r.label), el('span', 'formation-lev', `leva ${r.leverage.toFixed(2)}`));
      group.append(head);

      for (let i = 0; i < PER_ROLE; i++) {
        const s = picks[r.id][i];
        const slot = el('div', 'formation-slot');
        if (s) {
          slot.append(el('span', null, s.name), el('span', 'formation-kg', `${s.weight} kg`));
          const rm = el('button', 'formation-rm', '×');
          rm.type = 'button';
          rm.title = 'Rimuovi';
          rm.addEventListener('click', () => toggle(s));
          slot.append(rm);
        } else {
          slot.classList.add('is-empty');
          slot.append(el('span', 'formation-empty', '— vuoto —'));
        }
        group.append(slot);
      }
      box.append(group);
    }
  }

  function renderBudget() {
    const kg = totalWeight(fullRoster());
    $('budget-kg').textContent = kg;
    $('budget-picked').textContent = fullRoster().length;
    $('budget-fill').style.width = `${Math.min(100, (kg / WEIGHT_CAP) * 100)}%`;
    $('budget-fill').parentElement.classList.toggle('is-over', kg > WEIGHT_CAP);
  }

  function renderAverages() {
    const box = clear($('team-averages'));
    const roster = fullRoster();
    if (!roster.length) return;
    const t = teamStats(roster, factionId);
    for (const key of STATS) {
      const row = el('div');
      const label = el('span', null, STAT_LABEL[key]);
      if (key === faction.bonusStat) label.append(el('span', 'bonus-flag', ' +10%'));
      row.append(label, el('b', null, t[key].toFixed(0)));
      box.append(row);
    }
  }

  function renderControls() {
    const complete = currentPicks().length === PER_ROLE;
    const back = $('btn-roster-back');
    back.disabled = stepIdx === 0;

    const confirm = $('btn-roster-confirm');
    confirm.disabled = !complete;
    confirm.textContent = isLast() ? 'Conferma la formazione' : `Avanti · ${ROLES[stepIdx + 1].label}`;
  }

  $('btn-roster-back').onclick = () => { if (stepIdx > 0) { stepIdx--; render(); } };

  $('btn-roster-auto').onclick = () => {
    // Riempie la posizione con i migliori candidati che stanno ancora nel tetto.
    const ranked = bestForRole(pool[role().id], factionId, pool[role().id].length, currentPicks());
    for (const s of ranked) {
      if (currentPicks().length >= PER_ROLE) break;
      if (canAddToFormation(pool, picks, s)) currentPicks().push(s);
    }
    render();
  };

  $('btn-roster-confirm').onclick = () => {
    if (currentPicks().length < PER_ROLE) return;
    if (!isLast()) { stepIdx++; render(); return; }
    if (validateFormation(fullRoster()).ok) onConfirm(fullRoster());
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
