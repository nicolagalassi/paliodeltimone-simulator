/**
 * La mappa del Cammino del Palio: un percorso a bivi dalla partenza al Palio.
 *
 * Righe dal basso verso l'alto, quattro "corsie". Ogni riga ha due o tre tappe;
 * da una tappa si passa a quelle della riga dopo che stanno nella stessa corsia
 * o in una vicina. Con almeno due tappe per riga ogni tappa è raggiungibile e
 * ha un seguito; un ritocco finale lo garantisce comunque.
 *
 * Le tappe:
 *   tirata       — una tirata contro un quartiere rivale
 *   rivale       — un rivale più forte, con più bonus: più fiorini e un bonus
 *   evento       — un incontro in piazza, con una scelta
 *   bottega      — (la piazza del mercato) si spendono fiorini
 *   allenamento  — (l'antico lavatoio) si toglie o si raddoppia una carta
 *   osteria      — (la chiesa di San Paolo) si recupera un cuore, o si toglie una carta
 *   palio        — la tirata finale, contro il rivale storico
 *
 * Mercato, lavatoio e chiesa sono luoghi di Massa Lombarda: vedi NODE_INFO.
 */

export const LANES = 4;
export const ROWS = 8;               // righe di tappe prima del Palio

/**
 * Le tappe che non sono tirate stanno in luoghi veri di Massa Lombarda; il
 * Palio si corre sotto la Torre dell'Orologio. `short` è l'etichetta sulla
 * mappa. Gli id interni (bottega, osteria…) restano quelli di sempre, così i
 * cammini già salvati si riprendono.
 */
export const NODE_INFO = {
  tirata: { name: 'Tirata', short: 'Tirata', icon: '⚔', text: 'Una tirata contro un quartiere rivale.' },
  rivale: { name: 'Rivale', short: 'Rivale', icon: '☠', text: 'Un rivale agguerrito, con più bonus. Ricompensa più ricca.' },
  evento: { name: 'Evento', short: 'Evento', icon: '?', text: 'Un incontro in paese: una scelta da fare.' },
  bottega: { name: 'La Piazza del Mercato', short: 'Mercato', icon: '⚖', text: 'Ai banchi del mercato si comprano bonus con i fiorini.' },
  allenamento: { name: 'L’antico lavatoio', short: 'Lavatoio', icon: '≈', text: 'Allenamento: si toglie o si raddoppia una carta del mazzo.' },
  osteria: { name: 'La chiesa di San Paolo', short: 'Chiesa', icon: '✝', text: 'Si recupera un cuore, o si toglie una carta.' },
  palio: { name: 'La Torre dell’Orologio', short: 'Il Palio', icon: '★', text: 'Il Palio, sotto la Torre dell’Orologio, contro il rivale storico.' },
};

/** Pesi delle tappe nelle righe libere. */
const WEIGHTS = [
  ['tirata', 0.42], ['evento', 0.24], ['bottega', 0.12], ['allenamento', 0.14], ['osteria', 0.08],
];

function weighted(rng, table) {
  const tot = table.reduce((a, [, w]) => a + w, 0);
  let r = rng() * tot;
  for (const [k, w] of table) { r -= w; if (r <= 0) return k; }
  return table[table.length - 1][0];
}

/** Che tappe può avere la riga r (0 = la prima dopo la partenza). */
function rowType(r, rng) {
  if (r === 0) return 'tirata';
  if (r === 1) return rng() < 0.6 ? 'tirata' : 'evento';
  if (r === 4) return weighted(rng, [['rivale', 0.6], ['evento', 0.2], ['allenamento', 0.2]]);
  if (r === ROWS - 1) return rng() < 0.55 ? 'osteria' : 'bottega';
  return weighted(rng, WEIGHTS);
}

/**
 * Genera la mappa.
 * @param {Function} rng
 * @param {string[]} rivals   i quartieri avversari
 * @param {string} boss       il rivale storico, che aspetta al Palio
 */
export function generateMap(rng, rivals, boss) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const n = rng() < 0.45 ? 3 : 2;
    const lanes = rng.shuffle([0, 1, 2, 3]).slice(0, n).sort((a, b) => a - b);
    const row = lanes.map((lane, k) => ({ id: `n${r}-${k}`, row: r, lane, type: 'tirata', next: [] }));
    for (const node of row) node.type = rowType(r, rng);
    if (r === 4 && !row.some((x) => x.type === 'rivale')) row[Math.floor(rng() * row.length)].type = 'rivale';
    rows.push(row);
  }
  const palio = { id: 'palio', row: ROWS, lane: 1.5, type: 'palio', next: [], opp: boss };
  rows.push([palio]);

  // Collegamenti fra righe vicine: corsia uguale o accanto.
  for (let r = 0; r < ROWS - 1; r++) {
    const a = rows[r];
    const b = rows[r + 1];
    for (const x of a) {
      const near = b.filter((y) => Math.abs(y.lane - x.lane) <= 1);
      // Al massimo due sentieri per tappa: tre renderebbero ogni bivio indifferente.
      while (near.length > 2) {
        const side = near.filter((y) => y.lane !== x.lane);
        near.splice(near.indexOf(side[Math.floor(rng() * side.length)]), 1);
      }
      x.next = near.map((y) => y.id);
    }
    for (const x of a) {
      if (!x.next.length) x.next.push(nearest(b, x.lane).id);
    }
    for (const y of b) {
      if (!a.some((x) => x.next.includes(y.id))) nearest(a, y.lane).next.push(y.id);
    }
  }
  for (const x of rows[ROWS - 1]) x.next = ['palio'];

  // Gli avversari delle tirate, a caso fra i rivali.
  for (const row of rows) {
    for (const node of row) {
      if (node.type === 'tirata' || node.type === 'rivale') node.opp = rng.pick(rivals);
    }
  }
  return { rows, start: rows[0].map((x) => x.id) };
}

function nearest(row, lane) {
  return row.reduce((best, y) => (Math.abs(y.lane - lane) < Math.abs(best.lane - lane) ? y : best), row[0]);
}

/** Trova una tappa per id. */
export function nodeById(map, id) {
  for (const row of map.rows) for (const n of row) if (n.id === id) return n;
  return null;
}

/** Le tappe raggiungibili adesso: la prima riga all'inizio, poi i seguiti della tappa attuale. */
export function reachable(map, pos) {
  if (!pos) return map.start.slice();
  return nodeById(map, pos)?.next.slice() ?? [];
}
