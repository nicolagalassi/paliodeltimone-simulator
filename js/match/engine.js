/**
 * Motore della tirata: fisica pura, nessun riferimento al DOM.
 *
 * Lo stesso modulo alimenta il match giocato (60 fps con rendering) e la
 * simulazione headless degli incontri fra IA: gli avversari sono governati
 * dalle identiche regole che il giocatore sperimenta sul campo.
 *
 * GEOMETRIA
 *   θ  = angolo del timone. La croce ha quattro estremità: la squadra A occupa
 *        i bracci θ e θ+180°, la squadra B quelli a θ+90° e θ+270°.
 *   Per una squadra vale il braccio PIÙ VICINO all'arco, non uno dei due in
 *   particolare: entrambe le sue estremità sono buone. Così, a ogni quarto di
 *   giro, una squadra o l'altra passa davanti alla Zona Palio e l'arco conta
 *   sempre — invece di restare ininfluente per mezza rotazione.
 *   La Zona Palio è un arco fisso centrato su ZONE_CENTER di semi-ampiezza
 *   ZONE_HALF: sotto i 45° le due squadre non possono esservi dentro insieme,
 *   perché i loro bracci distano 90°.
 */

import { leverageOf } from '../core/roster.js';

const DEG = Math.PI / 180;

export const TUNING = {
  /* --- geometria --- */
  ZONE_CENTER: -90 * DEG,   // in alto sullo schermo
  // Ampiezza dell'arco. Sotto i 45° le due squadre non possono trovarvisi
  // dentro nello stesso istante, dato che i loro bracci distano 90°.
  ZONE_HALF: 18 * DEG,
  START_OFFSET: 45 * DEG,   // le due squadre partono equidistanti dall'arco

  /* --- inerzia e attrito ---
   * L'attrito viscoso è alto di proposito: il timone non è un volano che gira
   * libero, è una struttura che avanza solo finché la si spinge. È questo a
   * dare alla tirata la scala temporale giusta — coprire i 45° che separano il
   * palo dalla zona richiede spinta sostenuta, non uno strappo iniziale.
   */
  INERTIA_PER_KG: 10,
  FRICTION_VISCOUS: 1200,
  FRICTION_STATIC: 40,
  /* Il freno giostra è in prevalenza VISCOSO, cioè proporzionale alla velocità:
   * su una giostra lanciata morde forte, ma non la inchioda mai di colpo —
   * fermarla richiede insistere e perdere terreno nel frattempo. La componente
   * statica resta piccola e serve solo a spegnere l'ultimo strascico di moto.
   */
  BRAKE_VISCOUS_MULT: 3,
  BRAKE_STATIC: 380,

  /* --- coppia ---
   * La spinta è il gesto pieno: si va avanti, con le spalle contro il palo.
   * La tirata porta il palo a sé camminando all'indietro: stesso braccio, verso
   * opposto, ma posizione scomoda — meno resa e più fatica.
   */
  BASE_TORQUE: 1400,

  /* --- forza di spinta: Forza degli Esterni e peso ---
   * La spinta è il confronto di potenza, e qui deve vedersi. La coppia di
   * spinta e tirata nasce da due fattori che si moltiplicano:
   *
   *   FORZA  — media della Forza PESATA sulla leva della posizione. Gli Esterni,
   *     con il braccio più lungo, contano molto più degli Interni: una squadra
   *     con Esterni fortissimi spinge decisamente di più. L'esponente divarica
   *     il confronto, così la differenza di Forza è determinante e non cosmetica.
   *
   *   PESO   — i chili sui bracci sono spinta: a parità di Forza una squadra da
   *     540 kg vince quella da 450. Anche questo con un esponente, perché il
   *     vantaggio di peso non si annacqui.
   *
   * I riferimenti sono tarati perché una squadra media resti sulla scala di
   * coppia di prima (i tempi della tirata non cambiano); a divaricare sono gli
   * estremi. I due fattori NON compaiono in `power`: là restano freno, sotto,
   * prontezza e tenuta, dove a decidere sono altre statistiche.
   */
  FORCE_REF: 0.55,          // Forza-di-leva media → fattore 1
  FORCE_EXP: 1.7,           // quanto la Forza divarica la spinta
  FORCE_MIN: 0.5, FORCE_MAX: 2.2,
  WEIGHT_REF: 500,          // kg di riferimento → fattore 1
  WEIGHT_EXP: 3.2,          // quanto il peso incide sulla spinta
  WEIGHT_MIN: 0.5, WEIGHT_MAX: 1.8,
  /* La tirata non regge il confronto con la spinta, e non deve: chi si trova
   * girato male può resistere un momento, non tenere una posizione. Contro una
   * squadra che spinge, chi tira viene portato fuori — e in fretta. Per reggere
   * davvero bisogna passare sotto e rimettersi a spingere.
   */
  /* Lo strappo: nei primi istanti tirare rende quasi quanto spingere. È la
   * difesa immediata di chi si trova girato male con il palo in zona — più
   * rapida del sotto, che costa secondi di passaggio. Ma non si tiene: passato
   * lo strappo la resa crolla, perché camminare all'indietro non è una
   * posizione da cui si regge una contesa.
   */
  PULL_BURST_TIME: 2.6,
  PULL_BURST_EFF: 0.92,     // resa nello strappo iniziale
  PULL_EFFICIENCY: 0.42,    // resa a regime, dopo lo strappo
  PULL_DRAIN_MULT: 1.35,    // camminare all'indietro stanca di più
  // Presa passiva: una squadra senza comando non lascia comunque il timone.
  // Senza questo, un attimo di esitazione del chiamatore basta a far volare il
  // timone dall'altra parte, e la tirata si decide in pochi secondi.
  PASSIVE_GRIP: 380,
  SURGE_GAIN: 1.35,         // slancio nei primi istanti dopo il sotto
  SURGE_TIME: 2.5,

  /* --- sotto (passaggio sotto il palo) ---
   * Ribalta l'orientamento della squadra: dopo il passaggio si spinge nel verso
   * prima raggiungibile solo tirando. Mentre si passa non si applica forza, e
   * questo è il vero costo: in uno stallo, chi va sotto lascia partire la
   * giostra all'avversario che sta ancora spingendo a pieno.
   *
   * L'unica vera risposta a un sotto avversario è un sotto: chi resta girato
   * male non ha modo di opporsi. Per questo la sua DURATA dipende dalla
   * prontezza della squadra, come la riuscita: una squadra agile si rigira
   * quasi subito, una lenta arriva
   * troppo tardi e nel frattempo ha già perso terreno.
   */
  SOTTO_TIME_SLOW: 2.1,     // squadra poco pronta
  SOTTO_TIME_FAST: 0.9,     // squadra prontissima
  SOTTO_FAIL_MULT: 1.8,     // penalità di tempo in caso di errore
  /* Dopo un passaggio la squadra deve ricomporsi: non si va sotto due volte di
   * fila. Senza questo respiro il sotto diventa il comando che si usa sempre,
   * e la tirata si riduce a un alternarsi di passaggi invece che a una contesa
   * di spinta. */
  SOTTO_COOLDOWN: 3.0,

  /* Soglia di sicurezza del sotto. Sotto questa velocità il passaggio riesce
   * sempre, chiunque lo tenti: è la giostra domata, e il chiamatore deve poterci
   * contare per costruire la giocata. Sopra, la riuscita dipende da Agilità e
   * Gioco di squadra — e resta possibile anche in piena rotazione, solo rischiosa.
   */
  SOTTO_SAFE_OMEGA: 0.16,
  SOTTO_WILD_OMEGA: 0.95,   // giostra a tutta: qui conta solo quanto si è bravi
  SOTTO_WILD_MIN: 0.08,     // riuscita a tutta velocità, squadra poco agile
  SOTTO_WILD_MAX: 0.72,     // riuscita a tutta velocità, squadra agilissima

  /* --- fatica (in secondi assoluti, non scalata sul preset) ---
   * Il fiato è la risorsa che governa il ritmo, ma non deve essere il vincolo
   * che decide la tirata da solo. Con un ciclo troppo corto le squadre passano
   * il match a rifiatare: si spinge, si è a terra dopo pochi secondi, si frena,
   * si ricomincia — e chi ha più Resistenza vince a prescindere da come chiama.
   * Un ciclo lungo restituisce al chiamatore la scelta fra spinta, tirata e
   * sotto, e lascia alla Resistenza il ruolo che le compete: pesare nel finale,
   * non nei primi quindici secondi.
   */
  REF_DURATION: 60,         // durata di riferimento per la scala del campo
  DRAIN_PUSH: 0.024,        // ~42 s di spinta continua per svuotarsi
  DRAIN_BRAKE: 0.008,
  REGEN_BRAKE: 0.052,       // ~19 s piantati per tornare al massimo
  BRAKE_LOAD: 1.6,          // quanto il carico da reggere annulla quel recupero
  REGEN_IDLE: 0.022,
  /* Estremi del moltiplicatore di consumo. Vanno tenuti stretti: con un ciclo
   * di fatica lungo il vantaggio non si media su molti cicli, si accumula per
   * tutta la tirata, e pochi punti percentuali di consumo in meno diventano un
   * dominio. La Resistenza deve far arrivare in fondo con più fiato, non
   * rendere la tirata già decisa alla lettura delle rose.
   */
  DRAIN_AT_LOW_RES: 1.05,
  DRAIN_AT_HIGH_RES: 0.952,
  // Resa minima a fatica massima. Più in basso il divario fra chi gestisce il
  // ritmo e chi spinge alla cieca diventa incolmabile: una squadra esausta
  // renderebbe un terzo dell'avversaria e la tirata sarebbe già decisa.
  STAMINA_FLOOR: 0.45,

  /* --- varie --- */
  STEP: 1 / 60,
  MAX_OMEGA: 1.2,
};

/** Secondi che il palo impiegherebbe a raggiungere la zona all'attuale ω. */
export function timeToZone(distance, approachSpeed) {
  return approachSpeed > 1e-4 ? distance / approachSpeed : Infinity;
}

/** Normalizza un angolo in (-π, π]. */
export function normAngle(a) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Distanza angolare dal bordo più vicino della zona (0 se dentro), in radianti. */
export function distanceToZone(angle) {
  return Math.max(0, Math.abs(normAngle(angle - TUNING.ZONE_CENTER)) - TUNING.ZONE_HALF);
}

export const isInZone = (angle) => distanceToZone(angle) <= 0;

/* ---------------- comandi ---------------- */

/**
 * I comandi non prendono una direzione: la direzione appartiene alla squadra,
 * ed è quella in cui i tiratori guardano (`facing`).
 *   spinta → coppia nel verso di facing   (si va avanti)
 *   tirata → coppia nel verso opposto     (si porta il palo a sé, all'indietro)
 *   sotto  → si passa sotto il palo e facing si ribalta
 */
export const CMD = {
  idle:   () => ({ type: 'idle' }),
  push:   () => ({ type: 'push' }),
  pull:   () => ({ type: 'pull' }),
  brake:  () => ({ type: 'brake' }),
  sotto:  () => ({ type: 'sotto' }),
};

/** Verso della coppia prodotta da un comando, data l'orientamento della squadra. */
export function commandDirection(type, facing) {
  if (type === 'push') return facing;
  if (type === 'pull') return -facing;
  return 0;
}

/**
 * Pesi delle statistiche per ciascun comando. Ognuna ha un dominio proprio:
 *   Forza      — la coppia di spinta e tirata
 *   Agilità    — il passaggio sotto il palo: riuscita e rapidità
 *   Squadra    — la coordinazione, che entra ovunque senza dominare nulla
 *   Resistenza — non compare qui: governa la fatica (vedi `fatigue`)
 */
const WEIGHTS = {
  push:   { forza: 0.46, squadra: 0.34, agilita: 0.20, resistenza: 0 },
  pull:   { forza: 0.42, squadra: 0.32, agilita: 0.26, resistenza: 0 },
  brake:  { forza: 0.40, squadra: 0.32, agilita: 0.28, resistenza: 0 },
  sotto:  { agilita: 0.62, squadra: 0.38, forza: 0, resistenza: 0 },
  // Prontezza: quanto in fretta la squadra si rigira. Governa la durata del
  // sotto, non la sua riuscita.
  prontezza: { agilita: 0.66, squadra: 0.34, forza: 0, resistenza: 0 },
  // Tenuta: quanto lentamente ci si consuma e quanto in fretta si recupera.
  fatica: { resistenza: 0.78, squadra: 0.22, forza: 0, agilita: 0 },
};

/**
 * Quota di potenza garantita a chiunque scenda in campo. Comprime il divario
 * fra le rose: una squadra migliore parte in vantaggio, ma il margine resta
 * piccolo abbastanza perché a decidere la tirata sia la gestione del ritmo.
 *
 * Non va alzata troppo, però: comprimendo la coppia si comprimono anche i bonus
 * di fazione che ci passano dentro, e la Forza — che agisce solo qui — finisce
 * per valere una frazione di quel che valgono Resistenza o Gioco di squadra,
 * che entrano nel gioco per altre strade. Il quartiere della Forza si ritrova
 * allora col bonus meno utile dei quattro.
 */
const POWER_BASE = 0.55;

// Il freno passa dai bracci del timone: anche qui la posizione fa leva.
const LEVERED = new Set(['brake']);

/**
 * Potenza normalizzata (~0.55..1.0) della squadra per un dato comando.
 *
 * Vale per freno, sotto, prontezza e tenuta — non per spinta e tirata, che
 * hanno un modello a sé (vedi `forceRaw` e l'uso di FORCE_/WEIGHT_ in `step`).
 * Per il freno la media è pesata sulla leva della posizione.
 */
function power(team, kind) {
  const w = WEIGHTS[kind];
  const levered = LEVERED.has(kind);
  let sum = 0;
  let wsum = 0;
  team.stats.forEach((s, i) => {
    const contrib = (s.forza * w.forza + s.agilita * w.agilita
          + s.squadra * w.squadra + s.resistenza * w.resistenza) / 100;
    const lev = levered ? team.lever[i] : 1;
    sum += contrib * lev;
    wsum += lev;
  });
  const raw = Math.min(1.15, sum / wsum);
  return POWER_BASE + (1 - POWER_BASE) * raw;
}

/* Composizione della forza di spinta e tirata: la Forza domina, il Gioco di
 * squadra e l'Agilità danno un contributo minore. È volutamente più sbilanciata
 * sulla Forza dei pesi di `power`, perché è qui che la Forza deve pesare. */
const FORCE_BLEND = {
  push: { forza: 0.72, squadra: 0.18, agilita: 0.10 },
  pull: { forza: 0.66, squadra: 0.18, agilita: 0.16 },
};

/**
 * Forza di spinta/tirata della squadra, media PESATA sulla leva e NON compressa:
 * gli Esterni contano per il loro intero braccio, così una squadra con Esterni
 * fortissimi produce un valore nettamente più alto. Tipicamente ~0.35..1.0.
 */
function forceRaw(team, kind) {
  const w = FORCE_BLEND[kind];
  let sum = 0;
  let lw = 0;
  team.stats.forEach((s, i) => {
    const blend = (s.forza * w.forza + s.squadra * w.squadra + s.agilita * w.agilita) / 100;
    sum += blend * team.lever[i];
    lw += team.lever[i];
  });
  return sum / lw;
}

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/**
 * Prepara i dati immutabili di una squadra a partire dalla rosa.
 * Il bonus di fazione è applicato qui, una volta sola.
 * @param {string} factionId
 * @param {Array} roster
 * @param {{bonusStat:string, bonus:number}} bonusInfo
 */
export function makeTeam(factionId, roster, bonusInfo) {
  const stats = roster.map((s) => {
    const out = { ...s.stats };
    if (bonusInfo?.bonusStat) {
      out[bonusInfo.bonusStat] = Math.min(120, out[bonusInfo.bonusStat] * (bonusInfo.bonus ?? 1.1));
    }
    return out;
  });
  const mass = roster.reduce((sum, s) => sum + s.weight, 0);
  // Braccio di leva di ciascun tiratore, dalla sua posizione. Entra nella coppia
  // di spinta, tirata e freno: la Forza di un Esterno vale più di quella di un
  // Interno perché agisce più lontano dal perno.
  const lever = roster.map((s) => leverageOf(s.role));

  /* Disciplina di ciascun tiratore: quanto segue la chiamata del Chiamatore.
   * Nasce dal Gioco di squadra e per ora è solo un dato — la tirata la applica
   * ancora per intero. È l'aggancio per un futuro in cui, con una squadra poco
   * affiatata, qualcuno possa non rispettare il comando: la coppia si costruisce
   * già tiratore per tiratore (vedi `power`), quindi basterà far cadere qui il
   * contributo di chi non esegue. */
  const disciplineOf = stats.map((x) => Math.max(0, Math.min(1, x.squadra / 100)));

  const team = { factionId, stats, mass, roster, lever, disciplineOf };
  team.discipline = disciplineOf.reduce((a, b) => a + b, 0) / (disciplineOf.length || 1);
  team.power = {
    brake: power(team, 'brake'),
    sotto: power(team, 'sotto'),
    prontezza: power(team, 'prontezza'),
    fatica: power(team, 'fatica'),
  };

  /* Forza di spinta e tirata: Forza pesata sulla leva, poi divaricata da un
   * esponente attorno a un riferimento. È qui che una squadra con Esterni forti
   * spinge davvero di più. */
  team.forceRaw = { push: forceRaw(team, 'push'), pull: forceRaw(team, 'pull') };
  team.forceFactor = {
    push: clamp(TUNING.FORCE_MIN, TUNING.FORCE_MAX, (team.forceRaw.push / TUNING.FORCE_REF) ** TUNING.FORCE_EXP),
    pull: clamp(TUNING.FORCE_MIN, TUNING.FORCE_MAX, (team.forceRaw.pull / TUNING.FORCE_REF) ** TUNING.FORCE_EXP),
  };
  /* Il peso è spinta: a parità di Forza, la squadra più pesante vince. */
  team.weightFactor = clamp(
    TUNING.WEIGHT_MIN, TUNING.WEIGHT_MAX, (mass / TUNING.WEIGHT_REF) ** TUNING.WEIGHT_EXP,
  );
  /* La Resistenza si traduce in due moltiplicatori opposti: chi la possiede
   * consuma meno e recupera prima. È la statistica che decide chi regge la
   * giostra fino al calo e chi ci arriva svuotato. */
  const tenuta = (team.power.fatica - POWER_BASE) / (1 - POWER_BASE);
  team.drainMult = TUNING.DRAIN_AT_LOW_RES
    - (TUNING.DRAIN_AT_LOW_RES - TUNING.DRAIN_AT_HIGH_RES) * Math.max(0, Math.min(1, tenuta));
  team.regenMult = 1 / team.drainMult;
  /* Abilità nel sotto, NON compressa da POWER_BASE: qui la differenza fra le
   * rose deve vedersi. La compressione serve a evitare che una squadra
   * migliore vinca di forza bruta, ma sul passaggio sotto il palo è proprio
   * Agilità e Gioco di squadra che devono decidere chi osa e chi no. */
  const rawSotto = team.stats.reduce(
    (sum, x) => sum + (x.agilita * 0.62 + x.squadra * 0.38) / 100, 0,
  ) / team.stats.length;
  team.sottoSkill = Math.max(0, Math.min(1, (rawSotto - 0.45) / 0.35));

  // Durata del passaggio sotto il palo, dalla più lenta alla più pronta.
  // `power` sta in [POWER_BASE, 1]: si rinormalizza per usare tutto l'intervallo.
  const readiness = (team.power.prontezza - POWER_BASE) / (1 - POWER_BASE);
  team.sottoTime = TUNING.SOTTO_TIME_SLOW
    - (TUNING.SOTTO_TIME_SLOW - TUNING.SOTTO_TIME_FAST) * Math.max(0, Math.min(1, readiness));
  /* Coordinazione pura (solo Gioco di squadra, non compressa): governa quanto
   * in fretta il chiamatore IA legge la situazione e chiama il sotto difensivo.
   * Una squadra affiatata reagisce appena il palo entra in zona, una slegata
   * tentenna un paio di secondi — ed è tempo che l'avversario può sfruttare. */
  const rawCoord = team.stats.reduce((sum, x) => sum + x.squadra, 0) / team.stats.length / 100;
  team.coord = Math.max(0, Math.min(1, (rawCoord - 0.38) / 0.34));

  // Le rose pesanti frenano meglio ma reagiscono più lentamente.
  team.heaviness = mass / (roster.length * 90);
  return team;
}

/**
 * Orientamento iniziale: ogni squadra guarda verso il proprio palio, quindi la
 * tirata comincia con le due squadre che si spingono contro. È lo stallo di
 * partenza, e romperlo è il primo problema del chiamatore.
 */
function initialFacing(teamIndex) {
  return teamIndex === 0 ? 1 : -1;
}

function newTeamRuntime(teamIndex) {
  return {
    stamina: 1,
    facing: initialFacing(teamIndex),
    pullFor: 0,        // da quanto si sta tirando ininterrottamente
    sottoTimer: 0,
    sottoOk: false,
    sottoCooldown: 0,  // respiro obbligato prima di poter ripassare sotto
    surgeTimer: 0,
    hold: 0,
    maxHold: 0,
    timeInZone: 0,
    torque: 0,       // ultima coppia erogata (per il rendering delle frecce)
    lastCmd: 'idle',
  };
}

/**
 * @param {{teams:[object,object], preset:{duration:number,hold:number}, rng?:Function}} cfg
 */
export function createMatch({ teams, preset, rng = Math.random }) {
  const inertia = Math.max(1, (teams[0].mass + teams[1].mass) * TUNING.INERTIA_PER_KG);
  return {
    teams,
    preset,
    rng,
    inertia,
    /* La fatica NON segue la durata del preset: è assoluta.
     * Scalarla sembrava logico (stessa "forma" di match in entrambi i formati)
     * ma produce l'effetto opposto — in una tirata da 4 minuti nessuno si
     * logora mai, le squadre restano incollate alla soglia di riposo e la
     * partita si blocca in un ping-pong senza esito. Con un ciclo di fatica
     * assoluto, il formato lungo diventa quello che dovrebbe essere: una
     * guerra di logoramento con molti più cicli di sforzo e recupero.
     */
    timeScale: 1,
    /* I due formati condividono la stessa identica fisica: cambiano solo la
     * durata e i secondi di tenuta richiesti. Rallentare il campo nel formato
     * lungo, come avevo provato, non serviva a niente di buono — la giostra
     * girava piano e fermarsi nell'arco diventava troppo facile. */
    frictionScale: 1,
    theta: TUNING.ZONE_CENTER - TUNING.START_OFFSET,
    omega: 0,
    time: 0,
    finished: false,
    outcome: null,
    rt: [newTeamRuntime(0), newTeamRuntime(1)],
  };
}

/**
 * Angolo del braccio di riferimento di una squadra. Ogni squadra ne occupa
 * DUE, opposti fra loro: questo è il primo, l'altro sta a 180°.
 */
export const paloAngle = (m, i) => m.theta + (i === 1 ? Math.PI / 2 : 0);

/**
 * Il braccio della squadra più vicino alla Zona Palio.
 *
 * Conta il braccio più vicino, non uno solo dei due: la croce ha quattro
 * estremità e ignorarne metà significava che per mezzo giro la zona non
 * contava nulla, anche con un braccio della squadra esattamente dentro l'arco.
 * Così invece ogni 90° di rotazione una squadra o l'altra ci passa davanti.
 */
export function activeArm(m, i) {
  const a = paloAngle(m, i);
  const b = a + Math.PI;
  return distanceToZone(a) <= distanceToZone(b) ? a : b;
}

/** Distanza dalla zona del braccio più vicino della squadra. */
export const teamDistance = (m, i) => distanceToZone(activeArm(m, i));

/** La squadra ha un braccio dentro l'arco? */
export const teamInZone = (m, i) => teamDistance(m, i) <= 0;

/** Velocità della giostra, in giri al minuto: come la legge il chiamatore. */
export const giriAlMinuto = (omega) => Math.abs(omega) * 60 / (2 * Math.PI);

/** Soglia sotto la quale il passaggio riesce comunque, in giri al minuto. */
export const sogliaSicura = () => giriAlMinuto(TUNING.SOTTO_SAFE_OMEGA);

/**
 * Probabilità che il passaggio sotto il palo riesca, adesso, per la squadra i.
 *
 * Sotto la soglia di sicurezza è certo: la giostra è domata e il sotto è una
 * manovra di routine, su cui il chiamatore deve poter contare. Sopra, la
 * riuscita scende con la velocità e dipende da Agilità e Gioco di squadra —
 * ma non diventa mai impossibile: passare sotto in piena giostra è la giocata
 * azzardata che una squadra svelta può permettersi e una lenta no.
 */
export function sottoChance(m, i) {
  const w = Math.abs(m.omega);
  const safe = TUNING.SOTTO_SAFE_OMEGA;
  if (w <= safe) return 1;

  const team = m.teams[i];
  // Quanto si è oltre la soglia, da 0 (appena sopra) a 1 (giostra a tutta).
  const eccesso = Math.min(1, (w - safe) / Math.max(1e-6, TUNING.SOTTO_WILD_OMEGA - safe));
  const aTutta = TUNING.SOTTO_WILD_MIN
    + (TUNING.SOTTO_WILD_MAX - TUNING.SOTTO_WILD_MIN) * team.sottoSkill;

  return 1 + (aTutta - 1) * eccesso;
}

/** La squadra ha già smaltito il respiro dopo l'ultimo passaggio? */
export const sottoPronto = (m, i) => m.rt[i].sottoCooldown <= 0;

/** Fattore di resa dovuto alla fatica: mai zero, per evitare lo stallo totale. */
const staminaFactor = (st) => TUNING.STAMINA_FLOOR + (1 - TUNING.STAMINA_FLOOR) * st;

/**
 * Un passo di simulazione a dt fisso.
 * @param {object} m      stato del match (mutato in place)
 * @param {number} dt
 * @param {object} cmdA   comando della squadra A
 * @param {object} cmdB   comando della squadra B
 */
export function step(m, dt, cmdA, cmdB) {
  if (m.finished) return m;

  const cmds = [cmdA ?? CMD.idle(), cmdB ?? CMD.idle()];
  const fs = m.frictionScale ?? 1;
  let torque = 0;
  let viscous = TUNING.FRICTION_VISCOUS * fs;
  let staticFric = TUNING.FRICTION_STATIC * fs;

  for (let i = 0; i < 2; i++) {
    const team = m.teams[i];
    const rt = m.rt[i];
    const cmd = cmds[i];

    rt.surgeTimer = Math.max(0, rt.surgeTimer - dt);
    rt.sottoCooldown = Math.max(0, rt.sottoCooldown - dt);
    // Lo slancio della tirata si perde appena si fa altro: freno, sotto o spinta.
    if (cmd.type !== 'pull') rt.pullFor = 0;

    /* --- passaggio sotto il palo in corso: nessuna forza applicata --- */
    if (rt.sottoTimer > 0) {
      rt.sottoTimer -= dt;
      if (rt.sottoTimer <= 0) {
        rt.sottoTimer = 0;
        if (rt.sottoOk) {
          rt.facing *= -1;
          rt.surgeTimer = TUNING.SURGE_TIME;
        }
      }
      rt.torque = 0;
      rt.lastCmd = 'sotto';
      rt.stamina = Math.min(1, rt.stamina + TUNING.REGEN_IDLE * m.timeScale * dt * 0.5);
      continue;
    }

    /* --- avvio del sotto --- */
    if (cmd.type === 'sotto' && rt.sottoCooldown <= 0) {
      const chance = sottoChance(m, i);
      rt.sottoOk = m.rng() < chance;
      rt.sottoTimer = team.sottoTime * (rt.sottoOk ? 1 : TUNING.SOTTO_FAIL_MULT);
      rt.sottoCooldown = rt.sottoTimer + TUNING.SOTTO_COOLDOWN;
      rt.torque = 0;
      rt.lastCmd = 'sotto';
      continue;
    }

    /* --- freno giostra --- */
    if (cmd.type === 'brake') {
      const p = team.power.brake * staminaFactor(rt.stamina) * team.heaviness;
      viscous += TUNING.FRICTION_VISCOUS * TUNING.BRAKE_VISCOUS_MULT * p * 0.5 * fs;
      staticFric += TUNING.BRAKE_STATIC * p * fs;

      /* Piantarsi fa rifiatare solo se non si sta reggendo nulla. Assorbire una
       * spinta avversaria a piena forza costa quanto spingere: senza questo il
       * freno sarebbe una difesa perfetta e gratuita, capace di tenere una
       * posizione all'infinito, e la tirata si bloccherebbe lì.
       */
      const pressure = Math.min(1, Math.abs(m.rt[1 - i].torque) / TUNING.BASE_TORQUE);
      const regen = TUNING.REGEN_BRAKE * team.regenMult * (1 - TUNING.BRAKE_LOAD * pressure)
        - TUNING.DRAIN_BRAKE;
      rt.stamina = Math.max(0, Math.min(1, rt.stamina + regen * m.timeScale * dt));
      rt.torque = 0;
      rt.lastCmd = 'brake';
      continue;
    }

    /* --- spinta e tirata: stesso braccio, versi opposti --- */
    const dir = commandDirection(cmd.type, rt.facing);
    if (dir === 0) {
      staticFric += TUNING.PASSIVE_GRIP * team.power.brake * staminaFactor(rt.stamina) * fs;
      rt.stamina = Math.min(1, rt.stamina + TUNING.REGEN_IDLE * m.timeScale * dt);
      rt.torque = 0;
      rt.lastCmd = 'idle';
      continue;
    }

    const pulling = cmd.type === 'pull';
    const kind = pulling ? 'pull' : 'push';
    const surge = rt.surgeTimer > 0 ? TUNING.SURGE_GAIN : 1;

    // Lo strappo vale finché si tira di slancio, poi la resa scende a regime.
    if (pulling) rt.pullFor += dt;
    const burst = pulling && rt.pullFor <= TUNING.PULL_BURST_TIME;
    const gain = pulling
      ? (burst ? TUNING.PULL_BURST_EFF : TUNING.PULL_EFFICIENCY)
      : 1;

    // La coppia di spinta/tirata: Forza degli Esterni × peso della rosa. È il
    // confronto di potenza, e qui la squadra più forte e più pesante spinge di
    // più — nettamente, non di un'inezia.
    const effort = team.forceFactor[kind] * team.weightFactor
      * staminaFactor(rt.stamina) * surge * gain;
    const t = TUNING.BASE_TORQUE * effort * dir;

    torque += t;
    rt.torque = t;
    rt.lastCmd = kind;

    const drain = TUNING.DRAIN_PUSH * (0.7 + 0.3 * team.heaviness) * team.drainMult
      * (pulling ? TUNING.PULL_DRAIN_MULT : 1);
    rt.stamina = Math.max(0, rt.stamina - drain * m.timeScale * dt);
  }

  /* --- integrazione --- */
  const fric = -viscous * m.omega - staticFric * Math.sign(m.omega);
  let omega = m.omega + ((torque + fric) / m.inertia) * dt;
  // L'attrito statico non deve invertire il moto: al più lo azzera.
  if (Math.sign(omega) !== Math.sign(m.omega) && Math.abs(torque) < staticFric) omega = 0;
  m.omega = Math.max(-TUNING.MAX_OMEGA, Math.min(TUNING.MAX_OMEGA, omega));
  m.theta += m.omega * dt;
  m.time += dt;

  /* --- tenuta in zona --- */
  for (let i = 0; i < 2; i++) {
    const rt = m.rt[i];
    if (teamInZone(m, i)) {
      rt.hold += dt;
      rt.timeInZone += dt;
      rt.maxHold = Math.max(rt.maxHold, rt.hold);
    } else {
      rt.hold = 0;      // servono secondi *consecutivi*
    }
  }

  /* --- condizioni di fine --- */
  const holdTarget = m.preset.hold;
  const aWins = m.rt[0].hold >= holdTarget;
  const bWins = m.rt[1].hold >= holdTarget;
  if (aWins || bWins) {
    finish(m, aWins ? 0 : 1, 'hold');
  } else if (m.time >= m.preset.duration) {
    finishOnTime(m);
  }

  return m;
}

/** Allo scadere del tempo vince chi ha il palo più vicino alla Zona Palio. */
function finishOnTime(m) {
  const dA = teamDistance(m, 0);
  const dB = teamDistance(m, 1);

  if (Math.abs(dA - dB) > 1e-9) {
    finish(m, dA < dB ? 0 : 1, 'proximity');
    return;
  }
  // Perfetta equidistanza: decide la miglior tenuta accumulata.
  const hA = m.rt[0].maxHold;
  const hB = m.rt[1].maxHold;
  if (Math.abs(hA - hB) > 1e-9) {
    finish(m, hA > hB ? 0 : 1, 'proximity');
    return;
  }
  finish(m, null, 'draw');
}

function finish(m, winnerIndex, reason) {
  m.finished = true;
  m.outcome = {
    winnerIndex,
    winner: winnerIndex === null ? null : m.teams[winnerIndex].factionId,
    reason,
    holdHome: m.rt[0].maxHold,
    holdAway: m.rt[1].maxHold,
    proximityHome: teamDistance(m, 0) / DEG,
    proximityAway: teamDistance(m, 1) / DEG,
    elapsed: m.time,
  };
}

/**
 * Avanza il match di `elapsed` secondi reali con passo fisso, chiedendo i
 * comandi alle due callback. Usato sia dal loop di rendering sia dalla
 * simulazione headless.
 * @returns {number} tempo residuo non consumato dall'accumulatore
 */
export function advance(m, elapsed, getCmdA, getCmdB, acc = 0) {
  let budget = acc + elapsed;
  let guard = 0;
  while (budget >= TUNING.STEP && !m.finished && guard++ < 600) {
    step(m, TUNING.STEP, getCmdA(m), getCmdB(m));
    budget -= TUNING.STEP;
  }
  return budget;
}

/** Simulazione headless completa: nessun rendering, stesso motore. */
export function simulate(m, getCmdA, getCmdB) {
  const maxSteps = Math.ceil(m.preset.duration / TUNING.STEP) + 120;
  let n = 0;
  while (!m.finished && n++ < maxSteps) {
    step(m, TUNING.STEP, getCmdA(m), getCmdB(m));
  }
  if (!m.finished) finishOnTime(m);
  return m.outcome;
}
