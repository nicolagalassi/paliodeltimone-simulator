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

/* Quanto a lungo si insiste con una spinta che non muove il timone, prima di
 * cambiare gioco. Va tenuto basso rispetto ai secondi di tenuta richiesti: fra
 * l'accorgersi che la spinta non paga e il completare il passaggio sotto il
 * palo se ne vanno altri due, e l'avversario nel frattempo continua a contare.
 */
const OSTINAZIONE_MAX = 1.4;

/* Quanto in anticipo si legge l'arrivo del palo avversario sull'arco. Il valore
 * effettivo è modulato dal Gioco di squadra: una squadra affiatata vede la
 * giocata da lontano e ha il tempo di rigirarsi, una slegata se ne accorge
 * quando ormai può solo strappare. */
const ANTICIPO_BASE = 1.2;

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
  // Da quanto si spinge contro un timone che non si muove. È la misura
  // dell'ostinazione: oltre una certa soglia insistere non è più una tattica.
  let spintaVana = 0;
  // Soglie leggermente diverse per ogni chiamatore: due squadre con lo stesso
  // ciclo di fatica restano in fase e non succede mai niente.
  const restEnter = 0.24 + rng() * 0.16;
  const restExit = AI_RECOVER_TO * (0.85 + rng() * 0.3);

  return function decide(m) {
    // L'allarme scorre a ogni passo, non solo quando si rivaluta: altrimenti
    // il tempo di reazione dipenderebbe dal caso invece che dalla squadra.
    const minacciato = teamInZone(m, 1 - index);
    allarme = minacciato ? allarme + TUNING.STEP : 0;

    /* La spinta "paga" solo se il timone gira nel verso che porta l'avversario
     * fuori dall'arco. Contro una squadra girata bene e ben piantata le due
     * coppie si annullano: si spinge a pieno carico e il timone resta fermo,
     * mentre il cronometro dell'avversario continua a correre. Questo contatore
     * distingue lo sforzo che sta funzionando da quello sprecato. */
    const pagando = Math.sign(m.omega) === goalDir && Math.abs(m.omega) > 0.05;
    if (!minacciato) spintaVana = 0;
    else if (pagando) spintaVana = Math.max(0, spintaVana - TUNING.STEP * 2);
    else spintaVana += TUNING.STEP;

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
      allarme, reazione, spintaVana,
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

/* ==================== lettura del campo ==================== */

/**
 * Fra quanti secondi il palo della squadra `i` entrerà nell'arco, se il timone
 * continua a girare così. `Infinity` se non ci sta andando.
 *
 * È quello che un chiamatore legge guardando il campo: non si aspetta che
 * l'avversario sia dentro per muoversi, si vede arrivare e si prepara.
 */
function tempoAllIngresso(m, i) {
  const off = normAngle(activeArm(m, i) - TUNING.ZONE_CENTER);
  const margine = Math.abs(off) - TUNING.ZONE_HALF;
  if (margine <= 0) return 0;                                  // già dentro
  if (Math.abs(m.omega) < 1e-3) return Infinity;               // timone fermo
  // Ci si avvicina solo ruotando verso il centro dell'arco, non allontanandosi.
  if (Math.sign(m.omega) === Math.sign(off)) return Infinity;
  return margine / Math.abs(m.omega);
}

/* ==================== regime: stallo ==================== */

/**
 * Nello stallo il timone non si muove: chi è messo bene ci resta, chi è messo
 * male deve rimescolare, e l'unico modo è avviare la giostra passando sotto.
 */
function decideInStallo(m, ctx) {
  const {
    rt, foe, team, cfg, rng, goalDir, offset, dist, distFoe, fs,
    urgent, resting, mustHold, dentro,
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
   * Dentro la zona la spinta è l'ULTIMA risorsa, non la prima. Spingere contro
   * una squadra girata bene e piantata non porta via nessuno: le due coppie si
   * annullano, il timone resta fermo e lo stallo lavora per chi sta contando.
   * Quello che sposta davvero il timone è lo strappo della tirata, se si è
   * girati male, e il sotto, che allinea le due squadre e fa partire la giostra
   * portandosi via l'avversario. La spinta è ciò che si fa mentre si aspetta di
   * poter fare l'una o l'altro.
   */
  if (distFoe <= 0) {
    const puoSotto = rt.sottoTimer <= 0 && sottoPronto(m, ctx.index);
    const letto = ctx.allarme >= ctx.reazione;

    // Girati male: lo strappo è immediato, il sotto arriva appena letta la
    // situazione — prima le squadre affiatate, più tardi le altre.
    if (rt.facing !== goalDir) {
      if (letto && puoSotto && sottoChance(m, ctx.index) > 0.5) return CMD.sotto();
      return CMD.pull();
    }

    /* Girati bene: la spinta si tiene solo finché sta davvero muovendo il
     * timone. Appena smette di pagare si passa sotto — si perde la posizione,
     * ma restando fermi era comunque persa.
     */
    if (letto && puoSotto && ctx.spintaVana >= OSTINAZIONE_MAX
        && sottoChance(m, ctx.index) > 0.35) {
      return CMD.sotto();
    }
    return CMD.push();
  }

  /* --- l'avversario ci sta arrivando: si gioca d'anticipo ---
   * Aspettare che entri significa arrivare sempre un tempo dopo: il passaggio
   * sotto il palo dura secondi, e chiamarlo quando l'avversario è già dentro
   * vuol dire regalargli quei secondi. Un chiamatore lo vede arrivare e si
   * muove prima — o si rigira in tempo per accoglierlo spingendo, o gli strappa
   * il timone di mano prima che ci arrivi. Quanto lontano si legge la giocata
   * dipende dal Gioco di squadra: una squadra affiatata la vede da lontano.
   */
  const arrivo = tempoAllIngresso(m, 1 - ctx.index);
  const finestra = ANTICIPO_BASE * (0.45 + 0.75 * team.coord);

  if (arrivo < finestra) {
    if (rt.facing !== goalDir) {
      const puoSotto = rt.sottoTimer <= 0 && sottoPronto(m, ctx.index);
      // C'è tempo per completare il passaggio prima che entri: ci si rigira ora,
      // così lo si accoglie spingendo invece di subirlo girati male.
      if (arrivo > team.sottoTime * 0.9 && puoSotto && sottoChance(m, ctx.index) > 0.5) {
        return CMD.sotto();
      }
      // Troppo tardi per rigirarsi: si tira, e lo strappo è al suo massimo
      // proprio adesso.
      return CMD.pull();
    }
    /* Girati bene, con l'avversario che sta arrivando: la spinta lo respinge
     * prima che entri, ed è l'unico momento in cui è la giocata giusta contro
     * di lui — dentro l'arco non lo sarebbe più.
     *
     * A meno che non stia entrando comunque. Se il timone continua a portarlo
     * dentro nonostante la spinta, respingerlo non è più un'opzione: allora si
     * passa sotto adesso, prima che ci arrivi. Ci si allinea a lui e parte la
     * giostra — entra lo stesso, ma esce dopo un istante, e la tenuta non
     * comincia mai. È la stessa idea del contropiede: se non puoi fermare la
     * corsa, cambiala di natura.
     *
     * Non è però una mossa automatica: è una lettura, e va sbagliata a volte.
     * Applicata ogni volta che se ne presenta l'occasione nega all'avversario
     * qualunque tenuta — le tirate finiscono tutte allo scadere del tempo e la
     * Zona Palio smette di essere una posizione che si conquista. Quanto spesso
     * la si veda dipende dal Gioco di squadra.
     */
    const puoSotto = rt.sottoTimer <= 0 && sottoPronto(m, ctx.index);
    if (arrivo < team.sottoTime && puoSotto && sottoChance(m, ctx.index) > 0.4
        && rng() < 0.14 + 0.3 * team.coord) {
      return CMD.sotto();
    }
    // Non è il momento di rifiatare: chi si pianta a frenare lo lascia entrare
    // e poi dovrà tirarlo fuori, che costa molto di più.
    return rt.stamina > 0.2 ? CMD.push() : CMD.brake();
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
