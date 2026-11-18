/**
 * La formazione sul timone.
 *
 * Ogni squadra schiera sei tiratori su due bracci opposti. Ogni braccio ha tre
 * posizioni, dal perno verso l'esterno:
 *
 *   INTERNO  — vicino al perno: leva corta, il più leggero e agile.
 *   MEDIANO  — in mezzo al braccio: peso e leva intermedi.
 *   ESTERNO  — all'estremità: la leva più lunga, e quindi il più pesante.
 *
 * Nella tirata a carte tutte le squadre partono con la stessa formazione: a
 * distinguerle sono le carte e i bonus che guadagnano lungo il cammino. La
 * fisica della posizione però resta — la leva entra nella coppia (engine.js).
 */

export const ROLES = [
  { id: 'esterno', label: 'Esterno', short: 'EST', leverage: 1.30 },
  { id: 'mediano', label: 'Mediano', short: 'MED', leverage: 1.00 },
  { id: 'interno', label: 'Interno', short: 'INT', leverage: 0.70 },
];

export const ROLE_IDS = ROLES.map((r) => r.id);
export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));
export const leverageOf = (roleId) => ROLE_BY_ID[roleId]?.leverage ?? 1;

/* Un tiratore tipo per posizione: i pesanti forti, i leggeri agili. */
const TIPO = {
  esterno: { weight: 106, stats: { forza: 70, agilita: 45, squadra: 62, resistenza: 60 } },
  mediano: { weight: 88, stats: { forza: 58, agilita: 58, squadra: 62, resistenza: 60 } },
  interno: { weight: 71, stats: { forza: 46, agilita: 72, squadra: 62, resistenza: 60 } },
};

/** La formazione con cui scende in campo ogni squadra: due per posizione. */
export const BASE_ROSTER = Object.freeze(ROLE_IDS.flatMap((role) => [1, 2].map((n) => Object.freeze({
  id: `${role}-${n}`,
  role,
  name: `${ROLE_BY_ID[role].label} ${n}`,
  weight: TIPO[role].weight,
  stats: Object.freeze({ ...TIPO[role].stats }),
}))));

export const totalWeight = (roster) => roster.reduce((sum, s) => sum + s.weight, 0);
