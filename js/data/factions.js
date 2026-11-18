/**
 * I quattro quartieri del Palio. Nella tirata a carte partono tutti uguali: il
 * quartiere è un'identità e, quando lo si affronta, il carattere del suo
 * chiamatore (`aiStyle`).
 */

export const FACTIONS = [
  {
    id: 'sanpaolo',
    name: 'San Paolo',
    colorName: 'Rosso',
    color: '#c0392b',
    motto: 'Si vince all\u2019ultimo giro, non al primo.',
    aiStyle: 'calcolatore',
  },
  {
    id: 'sangiovanni',
    name: 'San Giovanni',
    colorName: 'Blu',
    color: '#2472e8',
    motto: 'Il timone cede prima delle nostre braccia.',
    aiStyle: 'aggressivo',
  },
  {
    id: 'bolognano',
    name: 'Bolognano',
    colorName: 'Arancione',
    color: '#e67e22',
    motto: 'Sotto il palo si passa in un respiro.',
    aiStyle: 'agile',
  },
  {
    id: 'meletolo',
    name: 'Meletolo',
    colorName: 'Verde',
    color: '#7ac943',
    motto: 'Sei uomini, una sola spinta.',
    aiStyle: 'metodico',
  },
];

export const FACTION_BY_ID = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

export function getFaction(id) {
  return FACTION_BY_ID[id] ?? FACTIONS[0];
}
