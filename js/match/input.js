/**
 * Traduce tastiera e pulsanti nel comando corrente del Chiamatore.
 *
 * Spinta, tirata e freno sono continui: valgono finché il tasto è premuto.
 * Il sotto è un impulso — si chiama una volta e la squadra esegue il passaggio.
 */

import { CMD } from './engine.js';

export function createInput(container) {
  const held = new Set();
  let impulse = null;          // 'sotto'
  let enabled = true;

  const KEYS = {
    KeyS: 'push', ArrowUp: 'push', Space: 'push',
    KeyT: 'pull', ArrowDown: 'pull',
    KeyI: 'sotto',
    KeyF: 'brake',
  };

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
