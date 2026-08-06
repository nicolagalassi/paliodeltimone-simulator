/** Schermata torneo: calendario, classifica, rosa, podio finale. */

import { el, clear } from './screens.js';
import { getFaction } from '../data/factions.js';
import {
  computeStandings, currentDay, allFixtures, finalsFixtures, computePodium,
} from '../core/tournament.js';
import { totalWeight } from '../core/roster.js';

const $ = (id) => document.getElementById(id);

export function renderTournament(state, { onPlay, onSimulateAll }) {
  const me = state.factionId;
  const teamIds = Object.keys(state.teams);
  const standings = computeStandings(state.schedule, teamIds);

  renderHead(state);
  renderCalendar(state, me);
  renderStandings(standings, me);
  renderMySquad(state);
  renderPlayButton(state, onPlay);
  renderSimulateButton(state, onSimulateAll);
}

function renderHead(state) {
  const faction = getFaction(state.factionId);
  document.documentElement.style.setProperty('--fc', faction.color);
  $('tournament-title').textContent = `Palio del Timone — ${faction.name}`;

  const done = allFixtures(state.schedule).filter((f) => f.played).length;
  const total = allFixtures(state.schedule).length;
  const preset = state.presetId === 'regolamentare' ? '4 min · 10 s' : '2 min · 10 s';

  $('tournament-subtitle').textContent = state.stage === 'done'
    ? 'Torneo concluso.'
    : state.stage === 'finals'
      ? `Fase finale · tirata ${preset}`
      : `Girone: ${done}/${total} tirate disputate · tirata ${preset}`;
}

function renderCalendar(state, me) {
  const box = clear($('calendar'));
  const day = currentDay(state.schedule);

  for (const d of state.schedule) {
    const card = el('div', 'matchday');
    card.classList.toggle('is-current', d === day && state.stage === 'group');
    card.append(el('div', 'matchday-title', d.label));
    for (const f of d.fixtures) card.append(fixtureRow(f, me, d === day));
    box.append(card);
  }

  if (state.finals) {
    const labels = ['Finale 3°/4° posto', 'Finale 1°/2° posto'];
    finalsFixtures(state.finals).forEach((f, i) => {
      const card = el('div', 'matchday');
      card.classList.toggle('is-current', state.stage === 'finals' && !f.played);
      card.append(el('div', 'matchday-title', labels[i]));
      card.append(fixtureRow(f, me, state.stage === 'finals' && !f.played));
      box.append(card);
    });
  }

  if (state.stage === 'done') box.prepend(podium(state));
}

function fixtureRow(f, me, isCurrent = false) {
  const row = el('div', 'fixture');
  const isMine = f.home === me || f.away === me;
  row.classList.toggle('is-mine', isMine);
  // Solo la tirata imminente va messa in risalto: marcare tutte quelle future
  // del giocatore fa perdere il senso di "questa è la prossima".
  row.classList.toggle('is-playable', isMine && !f.played && isCurrent);

  row.append(teamCell(f.home, 'left', f), scoreCell(f), teamCell(f.away, 'right', f));
  return row;
}

function teamCell(id, side, f) {
  const faction = getFaction(id);
  const cell = el('div', `fixture-team ${side}`);
  const dot = el('span', 'dot');
  dot.style.setProperty('--fc', faction.color);
  const name = el('span', null, faction.name);
  if (f.played && f.result) {
    name.className = f.result.winner === id ? 'fixture-winner'
      : f.result.winner === null ? '' : 'fixture-loser';
  }
  cell.append(dot, name);
  return cell;
}

function scoreCell(f) {
  if (!f.played || !f.result) return el('span', 'fixture-score', 'da giocare');
  const r = f.result;
  const label = r.reason === 'hold' ? 'tenuta'
    : r.reason === 'proximity' ? 'ai punti' : 'pari';

  const cell = el('span', 'fixture-score', `${r.holdHome.toFixed(1)}s – ${r.holdAway.toFixed(1)}s · ${label}`);
  cell.title = 'Secondi consecutivi in Zona Palio, casa – trasferta, '
    + 'e durata complessiva della tirata.';

  // I salvataggi precedenti non registravano la durata: si mostra solo se c'è.
  if (typeof r.elapsed === 'number') {
    cell.append(el('span', 'fixture-time', formatTime(r.elapsed)));
  }
  return cell;
}

function formatTime(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderStandings(standings, me) {
  const table = clear($('standings'));
  const head = el('tr');
  for (const h of ['#', 'Quartiere', 'G', 'V', 'N', 'P', 'Pti']) head.append(el('th', null, h));
  const thead = el('thead');
  thead.append(head);
  table.append(thead);

  const body = el('tbody');
  for (const row of standings) {
    const faction = getFaction(row.factionId);
    const tr = el('tr');
    tr.classList.toggle('is-mine', row.factionId === me);

    tr.append(el('td', 'pos', row.position));

    const nameTd = el('td');
    const cell = el('div', 'team-cell');
    const dot = el('span', 'dot');
    dot.style.setProperty('--fc', faction.color);
    cell.append(dot, el('span', null, faction.name));
    nameTd.append(cell);
    tr.append(nameTd);

    tr.append(
      el('td', null, row.played), el('td', null, row.won),
      el('td', null, row.drawn), el('td', null, row.lost),
      el('td', 'pts', row.points),
    );
    body.append(tr);
  }
  table.append(body);
}

function renderMySquad(state) {
  const box = clear($('my-squad'));
  const roster = state.roster;
  box.append(el('strong', null, `La tua rosa · ${totalWeight(roster)} kg`));
  const ul = el('ul');
  for (const s of roster) {
    const li = el('li');
    li.append(el('span', null, s.name), el('span', null, `${s.weight} kg`));
    ul.append(li);
  }
  box.append(ul);
}

function podium(state) {
  const p = computePodium(state.finals);
  const box = el('div', 'podium');
  const winner = getFaction(p[1]);
  box.append(el('h3', null, `Vince il Palio: ${winner.name}`));
  const ol = el('ol');
  for (const pos of [1, 2, 3, 4]) {
    const f = getFaction(p[pos]);
    const li = el('li', p[pos] === state.factionId ? 'fixture-winner' : null, f.name);
    ol.append(li);
  }
  box.append(ol);
  return box;
}

function renderPlayButton(state, onPlay) {
  const btn = $('btn-play-next');
  btn.onclick = onPlay;
  if (state.stage === 'done') {
    btn.textContent = 'Nuovo torneo';
  } else {
    const next = nextLabel(state);
    btn.textContent = next;
  }
  btn.disabled = false;
}

/**
 * Chi vuole solo comporre la rosa e vedere come va può saltare le tirate: il
 * torneo si risolve tutto d'un colpo con lo stesso motore. A podio assegnato
 * non c'è più niente da simulare, quindi il pulsante sparisce.
 */
function renderSimulateButton(state, onSimulateAll) {
  const btn = $('btn-sim-all');
  if (!btn) return;
  btn.hidden = state.stage === 'done';
  btn.disabled = false;
  btn.onclick = onSimulateAll;
  btn.textContent = state.stage === 'finals'
    ? 'Simula le finali'
    : 'Simula il resto del torneo';
}

function nextLabel(state) {
  if (state.stage === 'finals') return 'Gioca la finale';
  const day = currentDay(state.schedule);
  if (!day) return 'Prosegui';
  const mine = day.fixtures.find((f) => !f.played && (f.home === state.factionId || f.away === state.factionId));
  return mine ? `Gioca ${day.label}` : 'Prosegui la giornata';
}
