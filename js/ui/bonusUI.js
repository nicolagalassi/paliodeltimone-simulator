/** Bonus e mazzi a schermo: la scelta fra tre bonus e il riepilogo di un mazzo. */

import { el, clear } from './screens.js';
import { bonusInfo } from '../cards/bonus.js';
import { CARD_TYPES } from '../cards/cards.js';

/** Un bonus come carta da scegliere. */
export function bonusCard(id, onPick) {
  const info = bonusInfo(id);
  const btn = el('button', `bonus-option is-${info.kind}`);
  btn.type = 'button';
  btn.dataset.bonus = id;
  if (info.kind === 'card') {
    btn.dataset.type = info.card;
    btn.classList.add(`card-${CARD_TYPES[info.card].kind}`);
  }
  btn.append(
    el('span', 'bonus-kind', info.kind === 'card' ? 'Nuova carta' : 'Effetto permanente'),
    el('strong', 'bonus-name', info.name),
  );
  if (info.kind === 'card') btn.append(el('span', 'bonus-cost', `${info.cost}⚡ · ${info.dur} s`));
  btn.append(el('span', 'bonus-text', info.text));
  btn.addEventListener('click', () => onPick(id));
  return btn;
}

/** Riempie il contenitore con le offerte; `onPick` riceve l'id scelto. */
export function renderBonusChoice(container, offers, onPick) {
  clear(container).append(...offers.map((id) => bonusCard(id, onPick)));
}

/** Riepilogo di un mazzo: "4× Spinta 1⚡·2 s", raggruppato per carta. */
export function deckList(deckTypes) {
  const counts = new Map();
  for (const t of deckTypes) counts.set(t, (counts.get(t) ?? 0) + 1);
  const box = el('div', 'deck-items');
  for (const [type, n] of counts) {
    const t = CARD_TYPES[type];
    const item = el('span', `deck-item card-${t.kind}`);
    item.title = t.text;
    item.append(el('b', null, `${n}×`), el('span', null, ` ${t.name} `), el('em', null, `${t.cost}⚡·${t.dur}s`));
    box.append(item);
  }
  return box;
}

/** Nomi dei bonus-effetto presi, raggruppati ("Fiato lungo ×2"). */
export function effectList(bonusIds) {
  const counts = new Map();
  for (const id of bonusIds) {
    const info = bonusInfo(id);
    if (info.kind !== 'effect') continue;
    counts.set(info.name, (counts.get(info.name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
}
