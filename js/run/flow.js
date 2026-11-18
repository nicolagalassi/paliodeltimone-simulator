/**
 * Lo svolgimento del Cammino del Palio: dalla mappa alle tappe e ritorno.
 *
 * Ogni passo che cambia lo stato passa da `mutate`, quindi viene salvato.
 * Entrando in una tappa la si segna `pending`; finché non è risolta, riaprendo
 * il gioco si torna lì. Gli esiti che chiedono ancora una scelta (un bonus da
 * prendere, una carta da togliere) si annotano in `followUp`, così una pagina
 * ricaricata non fa rigiocare un evento né raddoppia una ricompensa.
 */

import {
  getState, setState, mutate, clearSave,
} from '../core/state.js';
import { showScreen, el } from '../ui/screens.js';
import {
  renderCammino, showScene, runStatus, deckPicker, bonusPicker, opponentSheet,
} from '../ui/camminoUI.js';
import * as C from './cammino.js';
import { NODE_INFO, nodeById } from './map.js';
import { hashSeed } from '../core/rng.js';
import { getFaction } from '../data/factions.js';
import { buildTeam } from '../match/match.js';
import { playCardMatch } from '../cards/cardMatch.js';
import { bonusInfo, offerBonuses } from '../cards/bonus.js';

const $ = (id) => document.getElementById(id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let onExit = () => {};

const STYLE_TEXT = {
  aggressivo: 'Il suo chiamatore è aggressivo: spinge e carica.',
  calcolatore: 'Il suo chiamatore è calcolatore: gioca il colpo giusto.',
  agile: 'Il suo chiamatore è agile: passa sotto e rimescola.',
  metodico: 'Il suo chiamatore è metodico: tiene e frena.',
};

/* ============================ ingresso e uscita ============================ */

export function startCammino({
  seed, presetId, factionId, loadout, exit,
}) {
  onExit = exit;
  setState(C.newCammino({
    seed, presetId, factionId, loadout,
  }));
  toMap();
}

export function resumeCammino(save, exit) {
  onExit = exit;
  setState(save, { save: false });
  if (save.stage === 'done') showEnd();
  else if (save.pending) openNode();
  else toMap();
}

$('btn-cammino-abandon').onclick = () => {
  if (!confirm('Abbandonare il cammino? I progressi andranno persi.')) return;
  clearSave();
  onExit();
};

function toMap() {
  const s = getState();
  if (s.stage === 'done') { showEnd(); return; }
  renderCammino(s, { onEnter });
  showScreen('cammino');
}

function onEnter(id) {
  mutate((s) => {
    C.enterNode(s, id);
    s.pending = true;
    s.followUp = null;
    s.bought = [];
  });
  openNode();
}

/** Tappa risolta: si torna alla mappa. */
function resolveNode() {
  mutate((s) => { s.pending = false; s.followUp = null; });
  toMap();
}

function openNode() {
  const s = getState();
  if (s.followUp) { showFollowUp(); return; }
  const node = C.currentNode(s);
  const kicker = `${NODE_INFO[node.type].name} · tappa ${Math.min(node.row + 1, 9)} di 9`;
  switch (node.type) {
    case 'tirata':
    case 'rivale':
    case 'palio': preFight(node, kicker); break;
    case 'evento': showEvent(kicker); break;
    case 'bottega': showShop(kicker); break;
    case 'allenamento': showTraining(kicker); break;
    case 'osteria': showInn(kicker); break;
    default: resolveNode();
  }
}

/* ============================ seguiti ============================ */

/** Un bonus da scegliere o una carta da togliere, rimasti in sospeso. */
function showFollowUp() {
  const s = getState();
  const f = s.followUp;
  if (f.kind === 'offers') {
    showScene({
      kicker: f.kicker ?? '',
      title: f.title ?? 'Scegli un bonus',
      text: f.text ?? '',
      seal: '✦',
      body: [runStatus(s), bonusPicker(f.offers, (id) => {
        mutate((st) => { C.gainBonus(st, id, f.why ?? 'Bonus'); });
        resolveNode();
      })],
    });
  } else if (f.kind === 'remove') {
    pickToRemove(f.text ?? '', resolveNode, f.title);
  } else {
    resolveNode();
  }
}

/** Fa scegliere una carta da togliere; poi `then`. */
function pickToRemove(text, then, title = 'Togli una carta') {
  const s = getState();
  showScene({
    kicker: 'Il mazzo',
    title,
    text: text || `Una carta in meno: le altre usciranno più spesso. Il mazzo non scende sotto ${C.MIN_DECK} carte.`,
    seal: '✂',
    body: [runStatus(s), deckPicker(s.loadout, (type) => {
      mutate((st) => { C.removeCard(st, type); });
      then();
    }, { verb: 'Togli' })],
    actions: [{ label: 'Lascia stare', onClick: then }],
  });
}

/* ============================ tirate ============================ */

function preFight(node, kicker) {
  const s = getState();
  const opp = getFaction(node.opp);
  const lo = C.opponentLoadout(s, node);
  const isPalio = node.type === 'palio';
  const fmt = C.tirataFormat(node);
  showScene({
    kicker,
    title: isPalio ? `Il Palio contro ${opp.name}` : `Contro ${opp.name}`,
    text: `${isPalio ? 'Sotto la Torre dell’Orologio la piazza è gremita. ' : ''}`
      + `${STYLE_TEXT[opp.aiStyle] ?? ''} ${isPalio
      ? 'È la tirata finale: vincerla è vincere il cammino.'
      : node.type === 'rivale'
        ? 'Un rivale agguerrito: se vinci, 30 fiorini e un bonus a scelta.'
        : 'Se vinci, 15 fiorini. Se perdi, un cuore.'}`,
    seal: NODE_INFO[node.type].icon,
    color: opp.color,
    body: [runStatus(s), opponentSheet(lo)],
    actions: [{
      label: 'Scendi in piazza',
      detail: `${fmt.battute} battute · vince chi tiene ${fmt.hold} s in zona`,
      primary: true,
      onClick: () => fight(node, lo),
    }],
  });
}

async function fight(node, oppLoadout) {
  const s = getState();
  const me = getFaction(s.factionId);
  const opp = getFaction(node.opp);
  showScreen('match');
  const result = await playCardMatch({
    homeTeam: buildTeam(s.factionId),
    awayTeam: buildTeam(node.opp),
    loadouts: [s.loadout, oppLoadout],
    controllers: [{ type: 'human', playerNo: 1 }, { type: 'ai' }],
    ...C.tirataFormat(node),
    seed: (Number(s.seed) ^ hashSeed(node.id)) >>> 0,
    title: `${me.name} – ${opp.name}`,
  });
  const esito = result.winner === s.factionId ? 'win' : result.winner ? 'loss' : 'draw';
  let out;
  // I bonus guadagnati in zona sono già nel mazzo: la sessione aggiorna il loadout.
  mutate((st) => {
    out = C.settleTirata(st, esito);
    if (out.bonusChoice) {
      st.followUp = {
        kind: 'offers',
        offers: offerBonuses(st.loadout, C.nodeRng(st, node.id, 5), 3),
        kicker: `Vittoria su ${opp.name}`,
        title: node.type === 'rivale' ? 'Il bottino del rivale' : 'Tirata vinta!',
        text: `+${out.fiorini} fiorini, e un bonus a scelta.`,
        why: 'Bottino',
      };
    }
  });
  if (out.ended) { showEnd(); return; }
  if (out.bonusChoice) { showFollowUp(); return; }

  const st = getState();
  showScene({
    kicker: `${me.name} – ${opp.name}`,
    title: esito === 'win' ? 'Tirata vinta!' : esito === 'loss' ? 'Tirata persa' : 'Tirata pari',
    text: esito === 'win'
      ? `+${out.fiorini} fiorini. La piazza è con te.`
      : esito === 'loss'
        ? `Perdi un cuore. Restano ${st.hearts} ${st.hearts === 1 ? 'cuore' : 'cuori'}, e ${out.fiorini} fiorini di consolazione.`
        : `Nessun cuore perso. +${out.fiorini} fiorini.`,
    seal: esito === 'win' ? '★' : esito === 'loss' ? '♡' : '=',
    color: esito === 'win' ? me.color : null,
    body: [runStatus(st)],
    actions: [{ label: 'Torna alla mappa', primary: true, onClick: resolveNode }],
  });
}

/* ============================ eventi ============================ */

function showEvent(kicker) {
  const s = getState();
  const ev = C.eventFor(s);
  showScene({
    kicker,
    title: ev.title,
    text: ev.text,
    seal: '?',
    body: [runStatus(s)],
    actions: ev.choices.map((ch) => {
      const ok = !ch.can || ch.can(s);
      return {
        label: ch.label,
        detail: ch.detail,
        disabled: !ok,
        why: 'Non puoi permettertelo adesso',
        onClick: () => chooseEvent(ev, ch),
      };
    }),
  });
}

function chooseEvent(ev, ch) {
  let r;
  mutate((s) => {
    r = ch.effect(s, C.eventRng(s));
    C.addLog(s, `${ev.title}: ${ch.label.toLowerCase()}`);
    if (r.offers) {
      s.followUp = {
        kind: 'offers', offers: r.offers, kicker: ev.title, title: 'Scegli un bonus', text: r.text, why: ev.title,
      };
    } else if (r.remove) {
      s.followUp = { kind: 'remove', text: r.text, title: 'Togli una carta' };
    }
  });
  if (r.offers || r.remove) { showFollowUp(); return; }
  showScene({
    kicker: ev.title,
    title: ch.label,
    text: r.text,
    seal: '?',
    body: [runStatus(getState())],
    actions: [{ label: 'Torna alla mappa', primary: true, onClick: resolveNode }],
  });
}

/* ============================ bottega ============================ */

function showShop(kicker) {
  const s = getState();
  const stock = C.shopStock(s);
  const bought = new Set(s.bought ?? []);
  const key = (it) => (it.kind === 'bonus' ? it.id : it.kind);

  const goods = el('div', 'shop-goods');
  for (const it of stock.filter((x) => x.kind === 'bonus')) {
    const info = bonusInfo(it.id);
    const sold = bought.has(key(it));
    const b = el('button', `shop-item${sold ? ' is-sold' : ''}`);
    b.type = 'button';
    b.append(
      el('span', 'bonus-kind', info.kind === 'card' ? 'Nuova carta' : 'Effetto permanente'),
      el('strong', 'bonus-name', info.name),
    );
    if (info.kind === 'card') b.append(el('span', 'bonus-cost', `${info.cost}⚡ · ${info.dur} s`));
    b.append(el('span', 'bonus-text', info.text), el('span', 'shop-price', sold ? 'venduto' : `${it.price} fiorini`));
    b.disabled = sold || s.fiorini < it.price;
    b.addEventListener('click', () => {
      mutate((st) => {
        st.fiorini -= it.price;
        st.bought.push(key(it));
        C.gainBonus(st, it.id, 'Al mercato');
      });
      showShop(kicker);
    });
    goods.append(b);
  }

  const remove = stock.find((x) => x.kind === 'remove');
  const heart = stock.find((x) => x.kind === 'heart');
  showScene({
    kicker,
    title: 'La Piazza del Mercato',
    text: 'Sotto i portici della piazza del mercato i banchi hanno poco, ma buono. Ogni cosa si compra una volta sola.',
    seal: '⚖',
    body: [runStatus(s), goods],
    actions: [
      {
        label: 'Togli una carta',
        detail: bought.has('remove') ? 'già fatto' : `${remove.price} fiorini`,
        disabled: bought.has('remove') || s.fiorini < remove.price || !C.canRemove(s),
        onClick: () => pickToRemove('', () => {
          mutate((st) => { st.fiorini -= remove.price; st.bought.push('remove'); });
          showShop(kicker);
        }),
      },
      {
        label: 'Un cuore',
        detail: bought.has('heart') ? 'già fatto' : `${heart.price} fiorini`,
        disabled: bought.has('heart') || s.fiorini < heart.price || s.hearts >= s.maxHearts,
        onClick: () => {
          mutate((st) => { st.fiorini -= heart.price; st.bought.push('heart'); C.healHeart(st); });
          showShop(kicker);
        },
      },
      { label: 'Lascia il mercato', primary: true, onClick: resolveNode },
    ],
  });
}

/* ============================ allenamento e osteria ============================ */

function showTraining(kicker) {
  const s = getState();
  showScene({
    kicker,
    title: 'L’antico lavatoio',
    text: 'All’antico lavatoio, fra le vasche di pietra, la squadra si allena con le funi bagnate. Puoi lasciare a casa una chiamata che non serve, o provarne una finché non viene da sola.',
    seal: '✦',
    body: [runStatus(s)],
    actions: [
      {
        label: 'Togli una carta',
        detail: 'il mazzo si assottiglia',
        disabled: !C.canRemove(s),
        onClick: () => pickToRemove('', resolveNode),
      },
      {
        label: 'Raddoppia una carta',
        detail: 'una copia in più nel mazzo',
        onClick: () => showScene({
          kicker: 'L’antico lavatoio',
          title: 'Raddoppia una carta',
          text: 'La carta scelta entra nel mazzo una volta in più.',
          seal: '✦',
          body: [runStatus(getState()), deckPicker(getState().loadout, (type) => {
            mutate((st) => { C.duplicateCard(st, type); });
            resolveNode();
          }, { verb: 'Raddoppia' })],
          actions: [{ label: 'Lascia stare', onClick: resolveNode }],
        }),
      },
    ],
  });
}

function showInn(kicker) {
  const s = getState();
  const full = s.hearts >= s.maxHearts;
  showScene({
    kicker,
    title: 'La chiesa di San Paolo',
    text: 'Nella penombra della chiesa di San Paolo la squadra si raccoglie prima di ripartire. C’è chi accende un cero, e chi ripensa alle chiamate sbagliate.',
    seal: '♨',
    body: [runStatus(s)],
    actions: [
      {
        label: 'Accendi un cero',
        detail: full ? 'i cuori sono già pieni' : '+1 cuore',
        disabled: full,
        onClick: () => { mutate((st) => { C.healHeart(st); C.addLog(st, 'In chiesa: +1 cuore'); }); resolveNode(); },
      },
      {
        label: 'Ripensa alle chiamate',
        detail: 'togli una carta',
        disabled: !C.canRemove(s),
        onClick: () => pickToRemove('', resolveNode),
      },
    ],
  });
}

/* ============================ fine ============================ */

function showEnd() {
  const s = getState();
  const me = getFaction(s.factionId);
  const boss = getFaction(s.boss);
  const won = s.outcome === 'win';
  const tirate = s.visited
    .filter((id) => ['tirata', 'rivale', 'palio'].includes(nodeById(s.map, id)?.type)).length;
  const summary = el('div', 'end-summary');
  summary.append(
    el('p', null, `${plural(s.visited.length, 'tappa', 'tappe')}, ${plural(tirate, 'tirata', 'tirate')}, `
      + `${plural(s.loadout.bonuses.length, 'bonus raccolto', 'bonus raccolti')}.`),
  );
  const log = el('ol', 'run-log');
  for (const l of s.log.slice(-8)) log.append(el('li', null, l.text));
  summary.append(log);
  showScene({
    kicker: 'Il Cammino del Palio',
    title: won ? `${me.name} vince il Palio!` : 'Il cammino finisce qui',
    text: won
      ? `${boss.name} si arrende alla tua ultima tirata. Il palio è del tuo quartiere.`
      : `${me.name} torna a casa. Il prossimo anno, ${boss.name} non sarà così fortunato.`,
    seal: won ? '★' : '✠',
    color: won ? me.color : null,
    body: [summary],
    actions: [{
      label: 'Nuovo cammino',
      primary: true,
      onClick: () => { clearSave(); onExit(); },
    }],
  });
}
