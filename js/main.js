/**
 * Bootstrap: scelta del quartiere → primo bonus → Cammino del Palio.
 *
 * Il gioco ha una sola modalità, il Cammino (vedi run/flow.js): una run
 * roguelike su una mappa a bivi, dalla partenza al Palio.
 */

import { FACTIONS, getFaction } from './data/factions.js';
import { makeRng, randomSeed } from './core/rng.js';
import { loadSave } from './core/state.js';
import { showScreen, el } from './ui/screens.js';
import { renderBonusChoice, deckList } from './ui/bonusUI.js';
import { startCammino, resumeCammino } from './run/flow.js';
import { BASE_DECK } from './cards/cards.js';
import { newLoadout, grantBonus, offerBonuses } from './cards/bonus.js';

const $ = (id) => document.getElementById(id);

let selectedFaction = null;

/** Come chiama un quartiere quando lo si affronta. */
const STYLE_LABEL = {
  aggressivo: 'chiamatore aggressivo: spinge e carica',
  calcolatore: 'chiamatore calcolatore: gioca il colpo giusto',
  agile: 'chiamatore agile: passa sotto e rimescola',
  metodico: 'chiamatore metodico: tiene e frena',
};

/* ==================== schermata del quartiere ==================== */

function renderFactionScreen() {
  const grid = $('faction-grid');
  grid.replaceChildren();

  for (const f of FACTIONS) {
    const card = el('button', 'faction-card');
    card.type = 'button';
    card.style.setProperty('--fc', f.color);
    card.dataset.id = f.id;

    const bonus = el('div', 'faction-bonus');
    bonus.append(el('strong', null, STYLE_LABEL[f.aiStyle] ?? ''), el('div', null, f.motto));
    const crest = el('div', 'faction-crest');
    crest.dataset.initial = f.name.split(' ').map((w) => w[0]).join('');
    card.append(
      crest,
      el('div', 'faction-name', f.name),
      el('div', 'faction-color', f.colorName),
      bonus,
    );

    card.addEventListener('click', () => {
      selectedFaction = f.id;
      for (const c of grid.children) c.classList.toggle('is-selected', c.dataset.id === f.id);
      $('btn-faction-confirm').disabled = false;
      document.documentElement.style.setProperty('--fc', f.color);
    });
    grid.append(card);
  }

  const resume = $('btn-continue-save');
  const save = loadSave();
  resume.hidden = !save;
  if (save) {
    resume.textContent = `Riprendi il cammino · ${getFaction(save.factionId).name}`;
    resume.onclick = () => resumeCammino(save, backToStart);
  }

  $('btn-faction-confirm').onclick = () => {
    if (selectedFaction) startRun(selectedFaction);
  };
}

/* ==================== primo bonus ==================== */

/** Fa scegliere il primo bonus; risolve con l'id scelto. */
function chooseFirstBonus({ factionId, loadout, rng }) {
  return new Promise((resolve) => {
    const faction = getFaction(factionId);
    document.documentElement.style.setProperty('--fc', faction.color);
    $('bonus-title').textContent = `${faction.name}: il primo bonus`;
    $('deck-preview').replaceChildren(deckList(loadout.deck));
    renderBonusChoice($('bonus-grid'), offerBonuses(loadout, rng), resolve);
    showScreen('bonus');
  });
}

/** Si parte con il mazzo base e un primo bonus a scelta, poi la mappa. */
async function startRun(factionId) {
  const seed = randomSeed();
  const rng = makeRng(seed ^ 0x5bd1e995);
  const loadout = newLoadout(BASE_DECK);
  grantBonus(loadout, await chooseFirstBonus({ factionId, loadout, rng }));
  startCammino({
    seed, factionId, loadout, exit: backToStart,
  });
}

/* ==================== avvio ==================== */

/** Torna alla scelta del quartiere (il salvataggio, se c'è, si può riprendere). */
function backToStart() {
  selectedFaction = null;
  $('btn-faction-confirm').disabled = true;
  renderFactionScreen();
  showScreen('faction');
}

renderFactionScreen();
showScreen('faction');
