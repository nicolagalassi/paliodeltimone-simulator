/**
 * PRNG seedabile. Serve a rendere riproducibili la generazione del pool,
 * dei roster IA e le simulazioni headless: stesso seed => stesso torneo.
 */

/** Hash di una stringa in un intero a 32 bit, per accettare seed testuali. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: piccolo, veloce, qualità più che sufficiente per il gioco. */
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 1;

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];

  /** Rumore ~gaussiano centrato su 0, deviazione ~0.29 (somma di 3 uniformi). */
  next.noise = () => (next() + next() + next()) / 3 - 0.5;

  next.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  return next;
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}
