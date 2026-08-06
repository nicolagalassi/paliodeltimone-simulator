/** I quattro quartieri del Palio, con il rispettivo bonus di fazione. */

export const STATS = ['forza', 'agilita', 'squadra', 'resistenza'];

export const STAT_LABEL = {
  forza: 'Forza',
  agilita: 'Agilità',
  squadra: 'Gioco di squadra',
  resistenza: 'Resistenza',
};

export const STAT_SHORT = {
  forza: 'FOR',
  agilita: 'AGI',
  squadra: 'SQD',
  resistenza: 'RES',
};

/** Moltiplicatore applicato alla statistica bonus del quartiere. */
export const FACTION_BONUS = 1.10;

export const FACTIONS = [
  {
    id: 'sanpaolo',
    name: 'San Paolo',
    colorName: 'Rosso',
    color: '#c0392b',
    bonusStat: 'resistenza',
    motto: 'Si vince all\u2019ultimo giro, non al primo.',
    aiStyle: 'calcolatore',
  },
  {
    id: 'sangiovanni',
    name: 'San Giovanni',
    colorName: 'Blu',
    color: '#2472e8',
    bonusStat: 'forza',
    motto: 'Il timone cede prima delle nostre braccia.',
    aiStyle: 'aggressivo',
  },
  {
    id: 'bolognano',
    name: 'Bolognano',
    colorName: 'Arancione',
    color: '#e67e22',
    bonusStat: 'agilita',
    motto: 'Sotto il palo si passa in un respiro.',
    aiStyle: 'agile',
  },
  {
    id: 'meletolo',
    name: 'Meletolo',
    colorName: 'Verde',
    color: '#7ac943',
    bonusStat: 'squadra',
    motto: 'Sei uomini, una sola spinta.',
    aiStyle: 'metodico',
  },
];

export const FACTION_BY_ID = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

export function getFaction(id) {
  return FACTION_BY_ID[id] ?? FACTIONS[0];
}
