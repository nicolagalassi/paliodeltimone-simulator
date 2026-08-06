/**
 * Chiamatore artificiale.
 *
 * Ragiona per REGIMI, come si gioca davvero una tirata:
 *
 *   STALLO — le due squadre spingono l'una contro l'altra e il timone quasi
 *     non si muove. Nessuno guadagna terreno: è la posizione di partenza e
 *     quella in cui si torna per fermare il palo dove serve.
 *
 *   GIOSTRA — dopo un sotto le due squadre si trovano a spingere nello stesso
 *     verso: le coppie si sommano e il timone parte in rotazione continua.
 *     Chi tira la rallenta appena. Dopo una decina di secondi la fatica la fa
 *     calare, ed è in quel calo che si gioca tutto.
 *
 * Il sotto è la chiave che apre e chiude entrambi i regimi: avvia la giostra
 * a chi sta perdendo la posizione, e la ferma a chi sa cronometrarlo — perché
 * tornare allo stallo con il proprio palo dentro l'arco significa vincere.
 */

import {
  CMD, TUNING, normAngle, activeArm, teamDistance, teamInZone, sottoChance, sottoPronto,
} from './engine.js';

/** Fiato da accumulare prima di provare a rompere uno stallo. */
const CHARGE_TO = 0.80;

/**
 * Quanto fiato recupera l'IA prima di tornare a spingere. È l'impazienza del
 * chiamatore artificiale, e la leva principale per renderlo più o meno duro.
 */
const AI_RECOVER_TO = 0.62;

/** Probabilità che il chiamatore tiri via una decisione. */
const SLOPPINESS = 0.10;

/* Tempo di reazione al palo avversario dentro l'arco, prima di chiamare il
 * sotto difensivo. Una squadra affiatata lo chiama quasi subito; una slegata
 * tentenna, e in quei secondi l'unica difesa che le resta è lo strappo della
 * tirata. Sono i due estremi: in mezzo decide il Gioco di squadra. */
const REAZIONE_LENTA = 2.4;
const REAZIONE_PRONTA = 0.15;

/* Carattere dei quattro chiamatori. I due parametri vanno tenuti vicini fra
 * loro: `anticipo` soprattutto, perché chiamare il sotto troppo presto o troppo
 * tardi rispetto alla durata del passaggio non è un modo di giocare, è un
 * errore — e uno stile che sbaglia sistematicamente il tempo condanna il suo
 * quartiere a prescindere dalla rosa. Le differenze restano di indole: chi
 * rimescola volentieri e chi preferisce la posizione acquisita.
 */
const STYLES = {
  aggressivo:  { react: 0.38, avviaGiostra: 0.68, anticipo: 1.00 },
  calcolatore: { react: 0.42, avviaGiostra: 0.52, anticipo: 1.12 },
  agile:       { react: 0.38, avviaGiostra: 0.64, anticipo: 1.08 },
  metodico:    { react: 0.44, avviaGiostra: 0.50, anticipo: 1.05 },
};

/** Le due squadre spingono nello stesso verso? Allora la giostra è partita. */
export const inGiostra = (m) => m.rt[0].facing === m.rt[1].facing;

/**
 * @param {number} index      0 = squadra A, 1 = squadra B
 * @param {string} style      chiave di STYLES
 * @param {Function} rng
 */
export function createAi(index, style = 'metodico', rng = Math.random) {
  const cfg = STYLES[style] ?? STYLES.metodico;
  // Verso che avvicina il proprio palo alla zona: A in senso positivo, B negativo.
  const goalDir = index === 0 ? 1 : -1;

  let cooldown = 0;
  let current = CMD.push();
  let resting = false;
  // Da quanto il palo avversario è dentro l'arco: è l'orologio della reazione.
  let allarme = 0;
  // Soglie leggermente diverse per ogni chiamatore: due squadre con lo stesso
  // ciclo di fatica restano in fase e non succede mai niente.
  const restEnter = 0.24 + rng() * 0.16;
  const restExit = AI_RECOVER_TO * (0.85 + rng() * 0.3);

  return function decide(m) {
    // L'allarme scorre a ogni passo, non solo quando si rivaluta: altrimenti
    // il tempo di reazione dipenderebbe dal caso invece che dalla squadra.
    allarme = teamInZone(m, 1 - index) ? allarme + TUNING.STEP : 0;

    cooldown -= TUNING.STEP;
    if (cooldown > 0) return current;
    cooldown = cfg.react * (0.75 + rng() * 0.5);
    if (rng() < SLOPPINESS) return current;

    const rt = m.rt[index];
    const foe = m.rt[1 - index];
    const team = m.teams[index];
    const fs = m.frictionScale ?? 1;

    // Si ragiona sempre sul braccio più vicino all'arco, non su uno fisso.
    const mine = activeArm(m, index);
    const offset = normAngle(mine - TUNING.ZONE_CENTER);
    const dist = teamDistance(m, index);
    const distFoe = teamDistance(m, 1 - index);
    const timeLeft = m.preset.duration - m.time;
    const urgent = timeLeft < m.preset.hold * 2.0;

    // Ciclo sforzo/recupero, sospeso quando non ci si può permettere di mollare.
    const mustHold = urgent || foe.hold > m.preset.hold * 0.45;
    if (resting && (rt.stamina > restExit || mustHold)) resting = false;
    else if (!resting && rt.stamina < restEnter && !mustHold) resting = true;

    // Prontezza difensiva: quanto tarda a leggere il pericolo e a chiamare il
    // sotto. Fino ad allora si difende con quello che ha sotto mano, la tirata.
    const reazione = REAZIONE_LENTA - (REAZIONE_LENTA - REAZIONE_PRONTA) * team.coord;

    const ctx = {
      index, rt, foe, team, cfg, rng, goalDir, offset, dist, distFoe, fs,
      urgent, resting, mustHold, dentro: teamInZone(m, index),
      allarme, reazione,
    };

    current = inGiostra(m) ? decideInGiostra(m, ctx) : decideInStallo(m, ctx);
    return current;
  };
}

/* ==================== regime: giostra ==================== */

/**
 * La giostra gira e non la si ferma spingendo contro: l'unico modo di uscirne
 * è il sotto, che va chiamato in anticipo perché il passaggio dura secondi e
 * il palo nel frattempo continua a correre.
 */
function decideInGiostra(m, ctx) {
  const { rt, team, cfg, offset, fs } = ctx;

  /* La giostra non è favorevole a nessuno: gira, e a ogni giro entrambi i pali
   * passano davanti all'arco. Non c'è quindi motivo di contrastarla — conta
   * solo chi sa uscirne al momento giusto. Chi la frena per principio si limita
   * a consumarsi e a regalare all'altro il tempo di prepararsi.
   */
  const lead = team.sottoTime * cfg.anticipo;
  const futuro = normAngle(offset + m.omega * lead);
  // Il palo arriverà dentro l'arco proprio mentre ci si sta rigirando?
  const arrivaInZona = Math.abs(futuro) < TUNING.ZONE_HALF * 0.8;

  // Quanto è probabile che il passaggio riesca adesso: sotto la soglia di
  // sicurezza è certo, in piena giostra è un azzardo che solo una squadra
  // svelta può permettersi.
  const chance = sottoChance(m, ctx.index);
  const puoSotto = rt.sottoTimer <= 0 && sottoPronto(m, ctx.index);

  // Il momento buono: il palo sta per entrare e il passaggio ha buone
  // probabilità. È la giocata che decide la tirata.
  if (puoSotto && arrivaInZona && chance > 0.5) return CMD.sotto();

  /* Occasione ghiotta ma giostra troppo veloce da lasciare: o si azzarda il
   * passaggio, o la si doma. Domarla si fa TIRANDO, non frenando: tirare mette
   * la squadra contro il verso di rotazione e la rallenta davvero, mentre il
   * freno costa la stessa fatica e regala terreno. Il freno resta la scelta di
   * chi non ha più fiato per tirare.
   */
  if (arrivaInZona) {
    if (puoSotto && chance > 0.3) return CMD.sotto();
    return rt.stamina > 0.3 ? CMD.pull() : CMD.brake();
  }

  /* Fuori dal momento buono si alimenta la giostra — ma solo finché resta una
   * giostra da cui si può uscire. Se ha preso troppo giro il sotto diventa
   * improbabile e continuare a spingere significa chiudersi dentro da soli:
   * meglio tirare per riportarla a una velocità da cui si esce.
   */
  if (chance < 0.4) return rt.stamina > 0.3 ? CMD.pull() : CMD.brake();
  return rt.stamina > 0.15 ? CMD.push() : CMD.brake();
}

/* ==================== regime: stallo ==================== */

/**
 * Nello stallo il timone non si muove: chi è messo bene ci resta, chi è messo
 * male deve rimescolare, e l'unico modo è avviare la giostra passando sotto.
 */
function decideInStallo(m, ctx) {
  const {
    rt, foe, cfg, rng, goalDir, offset, dist, distFoe, fs, urgent, resting, mustHold, dentro,
  } = ctx;

  /* --- il proprio palo è in zona: si tratta solo di restarci --- */
  if (dentro) {
    const towardEdge = Math.sign(m.omega) === Math.sign(offset) && offset !== 0;
    const margin = TUNING.ZONE_HALF - Math.abs(offset);
    const secondsToExit = towardEdge && Math.abs(m.omega) > 1e-4
      ? margin / Math.abs(m.omega)
      : Infinity;

    const want = secondsToExit < 7 ? -Math.sign(m.omega)
      : Math.abs(offset) > TUNING.ZONE_HALF * 0.6 ? -Math.sign(offset)
        : 0;

    if (want === 0) return CMD.brake();
    if (rt.facing === want) return CMD.push();
    // Girati male mentre si difende: passare sotto qui farebbe partire la
    // giostra e perdere la posizione, quindi si tira per resistere.
    return CMD.pull();
  }

  /* --- l'avversario è nell'arco: bisogna portarlo via ---
   * La risposta immediata non è il sotto ma lo STRAPPO: se si è girati male,
   * tirare produce subito coppia nel verso giusto, mentre il passaggio sotto il
   * palo costa secondi in cui l'avversario conta indisturbato. Nei primi istanti
   * la tirata rende quasi quanto una spinta, ed è la difesa che si improvvisa.
   * Il sotto arriva dopo, quando il chiamatore ha letto la situazione: le
   * squadre affiatate quasi subito, le altre con qualche secondo di ritardo —
   * e a quel punto lo strappo si è già esaurito.
   */
  if (distFoe <= 0) {
    if (rt.facing === goalDir) return CMD.push();

    const letto = ctx.allarme >= ctx.reazione;
    if (letto && rt.sottoTimer <= 0 && sottoPronto(m, ctx.index)
        && sottoChance(m, ctx.index) > 0.5) {
      return CMD.sotto();
    }
    return CMD.pull();
  }

  if (resting && !mustHold) return CMD.brake();

  /* --- si è messi peggio dell'avversario: si avvia la giostra ---
   * Nello stallo il timone non si muove, quindi restare fermi conserva una
   * posizione perdente. Chi ha il palo più lontano dall'arco non ha nulla da
   * perdere a rimescolare le carte; chi è messo meglio preferisce non rischiare.
   */
  const messoPeggio = dist > distFoe + TUNING.ZONE_HALF * 0.15;
  if (messoPeggio && rt.sottoTimer <= 0 && sottoPronto(m, ctx.index)
      && rt.stamina > CHARGE_TO * 0.6
      && sottoChance(m, ctx.index) > 0.7
      && rng() < cfg.avviaGiostra) {
    return CMD.sotto();
  }

  // Altrimenti si tiene la posizione spingendo contro.
  if (rt.facing === goalDir) return CMD.push();
  return rt.sottoTimer <= 0 && sottoPronto(m, ctx.index) && rng() < cfg.avviaGiostra
    ? CMD.sotto()
    : CMD.pull();
}

/** Stile del chiamatore artificiale di un quartiere. */
export const AI_STYLE_FOR = (faction) => faction?.aiStyle ?? 'metodico';
