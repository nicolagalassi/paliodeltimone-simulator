/**
 * Traduce tastiera e pulsanti nel comando corrente del Chiamatore.
 *
 * Spinta, tirata e freno sono continui: valgono finché il tasto è premuto.
 * Il sotto è un impulso — si chiama una volta e la squadra esegue il passaggio.
 *
 * La mappa dei tasti è un parametro: a giocatore singolo il Chiamatore ha tutti
 * gli alias comodi (lettere, frecce, barra), mentre a due giocatori sulla stessa
 * tastiera i due comandi vanno separati — le lettere a sinistra al primo, le
 * frecce a destra al secondo — perché nessun tasto risponda a entrambi.
 */

import { CMD } from './engine.js';

/** Giocatore unico: lettere mnemoniche più gli alias di frecce e barra. */
export const KEYS_SOLO = {
  KeyS: 'push', ArrowUp: 'push', Space: 'push',
  KeyT: 'pull', ArrowDown: 'pull',
  KeyI: 'sotto',
  KeyF: 'brake',
};

/** Primo giocatore in coppia: solo le lettere, a sinistra della tastiera. */
export const KEYS_P1 = {
  KeyS: 'push', KeyT: 'pull', KeyI: 'sotto', KeyF: 'brake',
};

/** Secondo giocatore in coppia: le frecce, a destra della tastiera. */
export const KEYS_P2 = {
  ArrowUp: 'push', ArrowDown: 'pull', ArrowRight: 'sotto', ArrowLeft: 'brake',
};

export function createInput(container, KEYS = KEYS_SOLO) {
  const held = new Set();
  let impulse = null;          // 'sotto'
  let enabled = true;

  // Ordine di precedenza quando più comandi continui sono premuti insieme.
  const PRIORITY = ['brake', 'pull', 'push'];

  function press(action) {
    if (!enabled) return;
    if (action === 'sotto') impulse = action;
    else held.add(action);
    reflect();
  }

  function release(action) {
    held.delete(action);
    reflect();
  }

  function onKeyDown(e) {
    const action = KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat && action === 'sotto') return;
    press(action);
  }

  function onKeyUp(e) {
    const action = KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    release(action);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /* ---- pulsanti su schermo (mouse + touch) ---- */
  const buttons = [...container.querySelectorAll('.cmd')];

  for (const btn of buttons) {
    const action = btn.dataset.cmd;
    const down = (e) => { e.preventDefault(); press(action); };
    const up = (e) => { e.preventDefault(); release(action); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  }

  /** Evidenzia i comandi attivi. */
  function reflect() {
    for (const btn of buttons) {
      const action = btn.dataset.cmd;
      btn.classList.toggle('is-active', held.has(action) || impulse === action);
    }
  }

  /** Consuma lo stato corrente e produce il comando per il motore. */
  function read() {
    if (!enabled) return CMD.idle();
    if (impulse === 'sotto') { impulse = null; reflect(); return CMD.sotto(); }
    for (const action of PRIORITY) {
      if (held.has(action)) return CMD[action === 'brake' ? 'brake' : action]();
    }
    return CMD.idle();
  }

  return {
    read,
    setEnabled(v) {
      enabled = v;
      if (!v) { held.clear(); impulse = null; reflect(); }
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      held.clear();
    },
  };
}
