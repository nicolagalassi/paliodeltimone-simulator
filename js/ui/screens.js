/** Router minimale: mostra una sola schermata alla volta. */

const screens = () => [...document.querySelectorAll('.screen')];

let current = null;
const onShow = new Map();

export function showScreen(name) {
  for (const el of screens()) {
    el.hidden = el.dataset.screen !== name;
  }
  current = name;
  window.scrollTo(0, 0);
  onShow.get(name)?.();
}

export const currentScreen = () => current;

/** Registra un callback eseguito ogni volta che la schermata viene mostrata. */
export function onScreen(name, fn) {
  onShow.set(name, fn);
}

/* ---- piccoli helper DOM condivisi ---- */

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}
