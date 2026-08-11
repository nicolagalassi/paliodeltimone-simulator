/**
 * Orchestrazione della tirata giocata: loop di rendering, HUD, esito.
 *
 * Il tempo di gioco avanza a passo fisso (TUNING.STEP) tramite un accumulatore,
 * così la fisica resta deterministica anche se il frame rate oscilla.
 */

import {
  createMatch, advance, teamDistance, TUNING, CMD, simulate,
  giriAlMinuto, sogliaSicura, sottoChance,
} from './engine.js';
import { createRenderer } from './renderer.js';
import { createInput, KEYS_SOLO, KEYS_P1, KEYS_P2 } from './input.js';
import { createAi } from './ai.js';
import { getFaction, FACTION_BONUS } from '../data/factions.js';
import { makeTeam } from './engine.js';
import { makeRng } from '../core/rng.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

/** Costruisce la squadra pronta per il motore a partire dai dati del torneo. */
export function buildTeam(factionId, roster) {
  const faction = getFaction(factionId);
  return makeTeam(factionId, roster, { bonusStat: faction.bonusStat, bonus: FACTION_BONUS });
}

/**
 * Simula un incontro senza rendering, con lo stesso motore del match giocato.
 * @returns {import('../core/tournament.js').MatchResult}
 */
export function simulateFixture({ homeTeam, awayTeam, preset, seed }) {
  const rng = makeRng(seed);
  const m = createMatch({ teams: [homeTeam, awayTeam], preset, rng });
  const aiHome = createAi(0, getFaction(homeTeam.factionId).aiStyle, rng);
  const aiAway = createAi(1, getFaction(awayTeam.factionId).aiStyle, rng);
  return toResult(simulate(m, aiHome, aiAway));
}

function toResult(outcome) {
  return {
    winner: outcome.winner,
    reason: outcome.reason,
    holdHome: round1(outcome.holdHome),
    holdAway: round1(outcome.holdAway),
    proximityHome: round1(outcome.proximityHome),
    proximityAway: round1(outcome.proximityAway),
    elapsed: round1(outcome.elapsed),
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

/** Mappa dei tasti per ciascuno schema di comando. */
const KEYMAPS = { solo: KEYS_SOLO, p1: KEYS_P1, p2: KEYS_P2 };

/**
 * I due pannelli di comando a schermo. Lo schema `p1` (lettere) sta sempre a
 * sinistra, lo `p2` (frecce) sempre a destra: così la legenda dei tasti resta
 * ferma e ciascun giocatore guarda sempre lo stesso pannello, mentre il lato di
 * campo che difende glielo dice il marcatore in alto.
 */
const PANEL = (playerNo) => (playerNo === 2
  ? { area: 'cmd-player-b', cmds: 'commands-b', label: 'cmd-label-b', hint: 'commands-hint-b' }
  : { area: 'cmd-player-a', cmds: 'commands', label: 'cmd-label-a', hint: 'commands-hint' });

/**
 * Avvia la tirata giocabile.
 * @param {object} cfg
 * @param {object} cfg.homeTeam    squadra all'indice 0
 * @param {object} cfg.awayTeam    squadra all'indice 1
 * @param {Array<{type:'ai'}|{type:'human',playerNo:1|2,keys:'solo'|'p1'|'p2'}>} cfg.controllers
 *   chi chiama ciascun lato: `[home, away]`. Un lato umano porta il numero del
 *   giocatore (1 o 2) e lo schema di tasti; un lato IA non porta nulla.
 * @param {boolean} [cfg.duo]      vero nel torneo a due umani: mostra le
 *   etichette "Giocatore 1/2" e i marcatori numerati invece del semplice "tu".
 * @param {object} cfg.preset      { duration, hold }
 * @param {number|string} cfg.seed
 * @param {string} cfg.title
 * @returns {Promise<object>} risultato orientato home/away
 */
export function playMatch({ homeTeam, awayTeam, controllers, preset, seed, title, duo = false }) {
  return new Promise((resolve) => {
    const rng = makeRng(seed);
    const m = createMatch({ teams: [homeTeam, awayTeam], preset, rng });

    const factions = [getFaction(homeTeam.factionId), getFaction(awayTeam.factionId)];
    const colors = factions.map((f) => f.color);

    const canvas = $('field');
    const renderer = createRenderer(canvas);

    /* ---- controllori: umani con pannello, IA senza ---- */
    // I due pannelli partono nascosti; li accende solo il lato che un umano
    // chiama davvero. `readers[i]` è la funzione che il motore interroga a ogni
    // passo per il comando del lato i.
    for (const p of [PANEL(1), PANEL(2)]) $(p.area).hidden = true;

    const humans = [];       // { index, playerNo, input, panelEl, hintEl, goalDir }
    const readers = [null, null];

    controllers.forEach((c, i) => {
      if (c.type === 'human') {
        const p = PANEL(c.playerNo);
        const input = createInput($(p.cmds), KEYMAPS[c.keys] ?? KEYS_SOLO);
        $(p.area).hidden = false;
        $(p.label).hidden = !duo;
        if (duo) $(p.label).textContent = `Giocatore ${c.playerNo} · ${factions[i].name}`;
        humans.push({
          index: i, playerNo: c.playerNo, input,
          panelEl: $(p.cmds), hintEl: $(p.hint), goalDir: i === 0 ? 1 : -1,
        });
        readers[i] = () => input.read();
      } else {
        readers[i] = createAi(i, factions[i].aiStyle, rng);
      }
    });

    // Con un solo umano la giostra mostra la sua probabilità di sotto; con due,
    // la lettura per squadra sarebbe ambigua su un indicatore solo, quindi resta
    // neutra sulla velocità. Nessun umano non capita da qui (le tirate fra sole
    // IA girano headless), ma per sicurezza cade anch'esso nel ramo neutro.
    const giostraFocus = humans.length === 1 ? humans[0].index : null;

    // Hotseat: col telefono steso fra i due, il pannello del Giocatore 2 va sul
    // bordo opposto e a testa in giù. Lo attiva solo una tirata fra due umani;
    // il posizionamento vero e proprio è in mobile.css, ristretto al verticale.
    $('screen-match').classList.toggle('is-hotseat', duo && humans.length === 2);

    /* ---- HUD statico ---- */
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
      badge.textContent = duo ? `G${h.playerNo}` : 'tu';
    }
    $('hud-you-a').style.setProperty('--tc', colors[0]);
    $('hud-you-b').style.setProperty('--tc', colors[1]);
    $('hud-name-a').style.setProperty('--tc', colors[0]);
    $('hud-name-b').style.setProperty('--tc', colors[1]);
    $('hud-hold-target').textContent = preset.hold;
    $('match-overlay').hidden = true;
    if (title) document.title = `${title} — Palio del Timone`;

    const els = {
      time: $('hud-time'),
      edge: $('hud-edge'),
      holdFill: [$('hold-fill-a'), $('hold-fill-b')],
      holdText: [$('hold-text-a'), $('hold-text-b')],
      stamina: [$('stamina-fill-a'), $('stamina-fill-b')],
    };
    els.holdFill[0].style.background = `linear-gradient(90deg, ${hexA(colors[0], 0.45)}, ${colors[0]})`;
    els.holdFill[1].style.background = `linear-gradient(270deg, ${hexA(colors[1], 0.45)}, ${colors[1]})`;

    renderer.resize();

    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let paused = false;

    const setInputs = (v) => { for (const h of humans) h.input.setEnabled(v); };

    const pauseOverlay = $('pause-overlay');
    function setPaused(v) {
      if (m.finished) return;
      paused = v;
      pauseOverlay.hidden = !v;
      setInputs(!v);
      // Al rientro il tempo riparte da adesso: la pausa non deve accumulare
      // secondi da smaltire tutti insieme al primo frame.
      if (!v) { last = performance.now(); acc = 0; }
    }
    $('btn-pause').onclick = () => setPaused(!paused);
    $('btn-resume').onclick = () => setPaused(false);
    const onPauseKey = (e) => {
      if (e.code !== 'KeyP' && e.code !== 'Escape') return;
      e.preventDefault();
      setPaused(!paused);
    };
    window.addEventListener('keydown', onPauseKey);

    function frame(now) {
      if (paused) {
        renderer.draw(m, colors, now);
        raf = requestAnimationFrame(frame);
        return;
      }

      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;

      acc = advance(m, dt, readers[0], readers[1], acc);
      renderer.draw(m, colors, now);
      updateHud(m, els, preset, factions, colors);
      updateGiostra(m, giostraFocus);
      for (const h of humans) updateCommandStates(m.rt[h.index], h.goalDir, h.hintEl, h.panelEl);

      if (m.finished) {
        setInputs(false);
        showOutcome(m, factions, humans, duo, () => {
          cancelAnimationFrame(raf);
          window.removeEventListener('keydown', onPauseKey);
          for (const h of humans) h.input.destroy();
          document.title = 'Palio del Timone — Simulatore';
          resolve(toResult(m.outcome));
        });
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
  });
}

/* ---------------- HUD ---------------- */

function updateHud(m, els, preset, factions, colors) {
  const left = Math.max(0, preset.duration - m.time);
  els.time.textContent = formatTime(left);
  els.time.classList.toggle('is-urgent', left <= 10);

  for (let i = 0; i < 2; i++) {
    const rt = m.rt[i];
    els.holdFill[i].style.width = `${Math.min(100, (rt.hold / preset.hold) * 100)}%`;
    els.holdText[i].textContent = `${rt.hold.toFixed(1)}s`;
    els.stamina[i].style.width = `${rt.stamina * 100}%`;
    els.stamina[i].classList.toggle('is-low', rt.stamina < 0.3);
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
function updateGiostra(m, focusIndex) {
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

/**
 * Il giocatore deve poter capire, senza calcoli, che effetto avrà ciascun
 * comando: dipende da come è girata la sua squadra, e il sotto ribalta tutto.
 */
function updateCommandStates(rt, goalDir, hintEl, panelEl = document) {
  const passing = rt.sottoTimer > 0;
  // Dopo un passaggio la squadra si ricompone: il comando resta spento finché
  // non è di nuovo disponibile, così il chiamatore non lo pesta a vuoto.
  // La ricerca è ristretta al pannello del giocatore: a due umani i comandi
  // sono due set distinti e uno non deve accendersi per lo stato dell'altro.
  const sottoBtn = panelEl.querySelector('.cmd[data-cmd="sotto"]');
  if (sottoBtn) sottoBtn.classList.toggle('is-cooling', passing || rt.sottoCooldown > 0);

  const pushBtn = panelEl.querySelector('.cmd[data-cmd="push"]');
  const pullBtn = panelEl.querySelector('.cmd[data-cmd="pull"]');
  const pushGoesToGoal = rt.facing === goalDir;

  if (pushBtn) pushBtn.classList.toggle('is-toward', pushGoesToGoal && !passing);
  if (pullBtn) pullBtn.classList.toggle('is-toward', !pushGoesToGoal && !passing);

  if (hintEl) {
    hintEl.textContent = passing
      ? 'La squadra sta passando sotto il palo: nessuna forza sul timone.'
      : pushGoesToGoal
        ? 'La tua squadra guarda verso la Zona Palio: la spinta avvicina il palo, la tirata lo allontana.'
        : 'La tua squadra guarda dalla parte opposta: la tirata avvicina il palo, la spinta lo allontana. Il sotto ti rigira.';
  }
}

function showOutcome(m, factions, humans, duo, onContinue) {
  const overlay = $('match-overlay');
  const { winnerIndex, reason } = m.outcome;

  const titleEl = $('overlay-title');
  const detailEl = $('overlay-detail');

  if (winnerIndex === null) {
    titleEl.textContent = 'Tirata pari';
    titleEl.style.setProperty('--oc', 'var(--ink)');
  } else if (duo) {
    // A due umani non c'è un "tu": vince un quartiere, e se a chiamarlo era un
    // giocatore lo si dice, così nessuno deve ricordare da che parte stava.
    const winnerHuman = humans.find((h) => h.index === winnerIndex);
    titleEl.textContent = winnerHuman
      ? `Vince Giocatore ${winnerHuman.playerNo}`
      : `Vince ${factions[winnerIndex].name}`;
    titleEl.style.setProperty('--oc', factions[winnerIndex].color);
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
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export { CMD, TUNING };
