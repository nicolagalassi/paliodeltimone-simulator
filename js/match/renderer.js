/**
 * Il campo in pixel art: la piazza vista di tre quarti, dall'alto e di sbieco.
 *
 * Tutto si disegna in un buffer piccolo (largo circa TARGET_W pixel "di gioco")
 * e poi lo si ingrandisce senza sfumature: ogni pixel del buffer diventa un
 * quadratino netto sullo schermo. Le forme si tracciano a pixel interi — niente
 * curve antialias — perché anche un solo bordo sfumato, ingrandito, rovina
 * l'effetto.
 *
 * GEOMETRIA
 *   Il mondo è il piano della piazza, misurato in lunghezze di braccio: il perno
 *   sta nell'origine e ogni braccio è lungo 1. Gli angoli sono quelli del motore
 *   (x = cos, y = sin, y verso lo spettatore), quindi la Zona Palio, a -90°,
 *   resta in alto sullo schermo — lontana, sul lato opposto della piazza.
 *   La camera guarda dall'alto di traverso: il terreno si schiaccia in verticale
 *   (tilt) e le altezze salgono sullo schermo (lift). L'inclinazione si adatta
 *   al riquadro: in uno spazio alto e stretto, come un telefono in verticale,
 *   la camera sale e guarda più dall'alto, così la piazza riempie lo schermo.
 *
 * Il renderer non sa nulla delle carte: legge dallo stato del match ciò che
 * ogni squadra sta facendo (`rt.lastCmd`, `rt.torque`, il sotto in corso) e lo
 * mostra con la posa dei tiratori. È ciò che fa capire, guardando il campo,
 * che cosa sta chiamando l'avversario.
 */

import { TUNING, paloAngle, activeArm, teamInZone, normAngle } from './engine.js';

const TILT_RANGE = [0.5, 0.8];   // schiacciamento del terreno: di sbieco … dall'alto
const BEAM_H = 0.16;        // altezza del timone da terra, in lunghezze di braccio
const ARENA_R = 1.2;        // raggio della piazza
const CROWD_R = [1.3, 1.46];
const TARGET_W = 250;       // larghezza del buffer, in pixel di gioco

const PAL = {
  outside: '#17130e',
  cobble: ['#3a3227', '#41382b', '#352e24', '#3e3529'],
  mortar: '#2a241b',
  curb: '#7b6a4f',
  curbHi: '#a08b66',
  curbLo: '#4d4130',
  wood: '#c9a36a',
  woodHi: '#ecd49c',
  woodLo: '#7d5c2e',
  post: '#5b4630',
  postHi: '#8a6c47',
  shadow: 'rgba(0, 0, 0, 0.34)',
  skin: '#e2b48a',
  skinLo: '#b88763',
  legs: '#2b2420',
  zone: '#9b2f63',
  zoneHi: '#d24c8d',
  palio: '#b3203a',
  gold: '#e8c35a',
  dust: '#9c8f78',
};

/* ---- piccoli aiuti di colore ---- */
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, f) {
  const [r, g, b] = hexRgb(hex);
  const t = f < 0 ? 0 : 255;
  const a = Math.abs(f);
  const c = (v) => Math.round(v + (t - v) * a);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
/** Rumore deterministico per il pavé e il pubblico. */
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas');
  const b = buf.getContext('2d');
  let bg = null;              // sfondo statico (pavé, cordolo)
  let zoneMask = [];          // pixel della Zona Palio, calcolati una volta
  let crowd = [];             // posizioni del pubblico
  let W = 0;
  let H = 0;
  let k = 1;                  // pixel di buffer per lunghezza di braccio
  let cx = 0;
  let cy = 0;
  let tilt = 0.56;            // schiacciamento del terreno
  let lift = 0.95;            // quanto sale sullo schermo un'altezza
  let cssKey = '';

  /* ---------------- proiezione ---------------- */
  const sx = (X) => cx + X * k;
  const sy = (Y, h = 0) => cy + Y * k * tilt - h * k * lift;
  const P = (X, Y, h = 0) => [Math.round(sx(X)), Math.round(sy(Y, h))];

  /* ---------------- primitive a pixel interi ---------------- */
  function rect(x, y, w, h, c) {
    b.fillStyle = c;
    b.fillRect(Math.round(x), Math.round(y), w, h);
  }
  /** Segmento a pixel netti, spesso `w`. */
  function line(x0, y0, x1, y1, c, w = 1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    b.fillStyle = c;
    const o = Math.floor(w / 2);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n) - o;
      const y = Math.round(y0 + ((y1 - y0) * i) / n) - o;
      b.fillRect(x, y, w, w);
    }
  }

  /* ---------------- dimensioni e sfondo ---------------- */
  function resize() {
    // Il canvas occupa il riquadro del suo contenitore (o, in mancanza, il suo).
    const box = (canvas.parentElement || canvas).getBoundingClientRect();
    // Si lascia un margine per la cornice, disegnata fuori dal canvas.
    const FRAME = 18;
    const cssW = Math.max(1, Math.floor(box.width) - FRAME);
    const cssH = Math.max(1, Math.floor(box.height) - FRAME);
    const key = `${cssW}x${cssH}`;
    if (key === cssKey && bg) return;
    cssKey = key;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // La risoluzione si regola sulla piazza, non sul riquadro: in uno spazio
    // largo e basso la piazza è piccola, e così i suoi pixel.
    const px = Math.max(2, Math.round(Math.min(cssW, cssH * 1.6) / TARGET_W));
    W = Math.max(40, Math.floor(cssW / px));
    H = Math.max(30, Math.floor(cssH / px));
    buf.width = W;
    buf.height = H;
    // Ingrandimento intero: ogni pixel di gioco diventa un quadrato di `px`
    // pixel CSS, tutti uguali. Il canvas è appena più piccolo del riquadro e ci
    // sta centrato.
    const s = Math.max(1, Math.round(dpr));
    canvas.width = W * px * s;
    canvas.height = H * px * s;
    canvas.style.width = `${W * px}px`;
    canvas.style.height = `${H * px}px`;

    // Inclinazione: quella che fa riempire alla piazza tutta l'altezza quando la
    // larghezza è il limite; poi la scala che fa stare tutto nel buffer.
    const R = CROWD_R[1];
    const kW = W / (2 * R + 0.06);
    const want = ((H - 16) / kW - 0.4) / (2 * R);
    tilt = Math.min(TILT_RANGE[1], Math.max(TILT_RANGE[0], want));
    lift = Math.sqrt(1 - tilt * tilt) * 1.15;
    k = Math.min(kW, (H - 16) / (2 * R * tilt + 0.42 * lift));
    cx = W / 2;
    cy = H / 2 + 0.12 * k * lift;
    buildBackground();
    buildZoneMask();
    buildCrowd();
  }

  /** Pavé a ciottoli, cordolo di pietra e buio attorno: si disegna una volta sola. */
  function buildBackground() {
    const img = b.createImageData(W, H);
    const put = (x, y, hex) => {
      const [r, g, bl] = hexRgb(hex);
      const i = (y * W + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = bl; img.data[i + 3] = 255;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const X = (x + 0.5 - cx) / k;
        const Y = (y + 0.5 - cy) / (k * tilt);
        const r = Math.hypot(X, Y);
        if (r > ARENA_R + 0.06) { put(x, y, PAL.outside); continue; }
        if (r > ARENA_R) {
          // Il cordolo: chiaro verso il fondo della piazza, scuro sul davanti.
          put(x, y, Y < -0.2 ? PAL.curbHi : Y > 0.4 ? PAL.curbLo : PAL.curb);
          continue;
        }
        // Ciottoli: una griglia sfalsata nel piano, con le fughe più scure.
        const u = X * 13;
        const v = Y * 13 + (Math.floor(X * 13) % 2 ? 0.5 : 0);
        const fu = u - Math.floor(u);
        const fv = v - Math.floor(v);
        if (fu < 0.12 || fv < 0.16) { put(x, y, PAL.mortar); continue; }
        const tone = hash(Math.floor(u), Math.floor(v));
        put(x, y, PAL.cobble[Math.floor(tone * PAL.cobble.length)]);
      }
    }
    bg = img;
  }

  /** I pixel della Zona Palio, una fascia lungo il bordo nel suo arco. */
  function buildZoneMask() {
    zoneMask = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const X = (x + 0.5 - cx) / k;
        const Y = (y + 0.5 - cy) / (k * tilt);
        const r = Math.hypot(X, Y);
        if (r < 1.03 || r > ARENA_R - 0.01) continue;
        const a = Math.atan2(Y, X);
        const d = Math.abs(normAngle(a - TUNING.ZONE_CENTER));
        if (d <= TUNING.ZONE_HALF) zoneMask.push(x, y, (x + y) % 2, d > TUNING.ZONE_HALF - 0.03 ? 1 : 0);
      }
    }
  }

  /** Il pubblico attorno alla piazza: posizioni e colori fissi, si muove solo un po'. */
  function buildCrowd() {
    crowd = [];
    const n = Math.round(2 * Math.PI * CROWD_R[1] * k / 4);
    const palette = ['#c0392b', '#2472e8', '#e67e22', '#7ac943', '#d9c7a1', '#8d6e5a', '#5b6b7a', '#e8d6b0'];
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < n; i++) {
        const a = ((i + row * 0.5) / n) * Math.PI * 2;
        // Lasciano libero il varco del palio, in fondo alla piazza.
        if (Math.abs(normAngle(a - TUNING.ZONE_CENTER)) < 0.42) continue;
        const r = CROWD_R[0] + row * (CROWD_R[1] - CROWD_R[0]);
        const h = hash(i, row + 7);
        crowd.push({
          X: Math.cos(a) * r, Y: Math.sin(a) * r,
          shirt: palette[Math.floor(h * palette.length)],
          phase: h * 6.28,
        });
      }
    }
  }

  /* ---------------- disegno ---------------- */
  function draw(m, colors, t = 0) {
    if (!bg) resize();
    b.putImageData(bg, 0, 0);

    const front = [];        // cose da disegnare in ordine di profondità
    drawZone(m, colors, t);
    drawCrowd(t, false);
    drawPalioBanner(t);
    drawShadow(m);
    queueTimone(m, colors, front);
    queueShooters(m, colors, t, front);
    queueFlags(m, colors, t, front);
    front.sort((p, q) => p.z - q.z);
    for (const d of front) d.draw();
    drawArrows(m, colors);
    drawCrowd(t, true);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
  }

  /** La fascia della Zona Palio: rosa a riposo, del colore di chi la occupa. */
  function drawZone(m, colors, t) {
    const who = teamInZone(m, 0) ? 0 : teamInZone(m, 1) ? 1 : -1;
    const pulse = who >= 0 && Math.floor(t / 260) % 2 === 0;
    const base = who >= 0 ? colors[who] : PAL.zone;
    const c0 = who >= 0 ? shade(base, pulse ? 0.25 : 0) : PAL.zone;
    const c1 = who >= 0 ? shade(base, -0.25) : shade(PAL.zone, -0.25);
    for (let i = 0; i < zoneMask.length; i += 4) {
      const edge = zoneMask[i + 3];
      b.fillStyle = edge ? PAL.zoneHi : (zoneMask[i + 2] ? c0 : c1);
      b.fillRect(zoneMask[i], zoneMask[i + 1], 1, 1);
    }
  }

  /** Il drappo del palio, issato in fondo alla piazza dietro la zona. */
  function drawPalioBanner(t) {
    const X = Math.cos(TUNING.ZONE_CENTER) * (ARENA_R + 0.16);
    const Y = Math.sin(TUNING.ZONE_CENTER) * (ARENA_R + 0.16);
    const [x0, y0] = P(X - 0.16, Y);
    const [x1, y1] = P(X + 0.16, Y);
    const top = Math.round(0.44 * k * lift);
    line(x0, y0, x0, y0 - top, PAL.post, 1);
    line(x1, y1, x1, y1 - top, PAL.post, 1);
    rect(x0 - 1, y0 - top - 1, x1 - x0 + 3, 1, PAL.gold);
    const sway = Math.round(Math.sin(t / 420));
    const clothH = Math.round(top * 0.62);
    for (let x = x0 + 1; x < x1; x++) {
      const off = x === x0 + 1 || x === x1 - 1 ? 0 : sway;
      rect(x + off, y0 - top, 1, clothH, (x - x0) % 4 === 0 ? PAL.gold : PAL.palio);
    }
    rect(x0 + 1 + sway, y0 - top + clothH, x1 - x0 - 1, 1, PAL.gold);
  }

  /** Ombra della croce sul pavé, appena spostata: dà l'altezza al timone. */
  function drawShadow(m) {
    for (let i = 0; i < 2; i++) {
      const a = paloAngle(m, i);
      const [x0, y0] = P(-Math.cos(a) * 1.0 + 0.05, -Math.sin(a) * 1.0 + 0.05);
      const [x1, y1] = P(Math.cos(a) * 1.0 + 0.05, Math.sin(a) * 1.0 + 0.05);
      line(x0, y0, x1, y1, PAL.shadow, 2);
    }
  }

  /** Il timone: quattro bracci divisi in tratti, ordinati con i tiratori per profondità. */
  function queueTimone(m, colors, front) {
    const SEG = 8;
    const thick = Math.max(2, Math.round(k * 0.035));
    for (let i = 0; i < 2; i++) {
      for (const a of [paloAngle(m, i), paloAngle(m, i) + Math.PI]) {
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        for (let s = 0; s < SEG; s++) {
          const d0 = 0.06 + (s / SEG) * 0.94;
          const d1 = 0.06 + ((s + 1) / SEG) * 0.94;
          const zMid = sy(uy * (d0 + d1) / 2);
          front.push({
            z: zMid + 0.2,
            draw() {
              const [x0, y0] = P(ux * d0, uy * d0, BEAM_H);
              const [x1, y1] = P(ux * d1, uy * d1, BEAM_H);
              line(x0, y0 + 1, x1, y1 + 1, PAL.woodLo, thick);
              line(x0, y0, x1, y1, PAL.wood, thick);
              line(x0, y0 - Math.floor(thick / 2), x1, y1 - Math.floor(thick / 2), PAL.woodHi, 1);
            },
          });
        }
      }
    }
    // Il perno: un palo piantato al centro, con il cappello sopra la croce.
    front.push({
      z: cy + 0.1,
      draw() {
        const [x, y] = P(0, 0);
        const top = Math.round(BEAM_H * k * lift) + 3;
        rect(x - 2, y - top, 4, top + 1, PAL.post);
        rect(x - 2, y - top, 1, top + 1, PAL.postHi);
        rect(x - 3, y - top - 2, 6, 2, PAL.gold);
      },
    });
  }

  /**
   * La posa di un tiratore dice che cosa sta facendo la sua squadra:
   *   spinta  — chino in avanti, a passo lungo;
   *   tirata  — sbilanciato all'indietro, le braccia tese al palo;
   *   freno   — gambe larghe, basso, piantato;
   *   sotto   — accucciato sotto il braccio, mentre passa;
   *   presa   — in piedi, fermo.
   */
  function poseOf(rt) {
    if (rt.sottoTimer > 0) return 'sotto';
    if (rt.lastCmd === 'push') return 'push';
    if (rt.lastCmd === 'pull') return 'pull';
    if (rt.lastCmd === 'brake') return 'brake';
    return 'idle';
  }

  function queueShooters(m, colors, t, front) {
    const slots = [0.42, 0.61, 0.8];
    for (let i = 0; i < 2; i++) {
      const rt = m.rt[i];
      const pose = poseOf(rt);
      const shirt = colors[i];
      const dark = shade(shirt, -0.45);
      const light = shade(shirt, 0.3);
      // Verso della coppia della squadra, per sapere da che parte si sbilanciano.
      const dir = Math.sign(rt.torque) || 0;
      const working = pose === 'push' || pose === 'pull';

      for (let arm = 0; arm < 2; arm++) {
        const a = paloAngle(m, i) + arm * Math.PI;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const tx = -uy;
        const ty = ux;
        slots.forEach((d, s) => {
          // Dietro al braccio rispetto a dove guardano; a cavallo durante il sotto.
          const off = pose === 'sotto' ? 0 : -rt.facing * 0.075;
          const X = ux * d + tx * off;
          const Y = uy * d + ty * off;
          const lean = working ? Math.sign(tx * dir) : 0;
          const look = Math.sign(tx * rt.facing) || 1;
          const step = working ? Math.floor(t / 140 + s + arm * 2) % 2 : 0;
          const [hx, hy] = P(ux * d, uy * d, BEAM_H);
          front.push({
            z: sy(Y),
            draw() {
              const [x, y] = P(X, Y);
              drawShooter(x, y, { pose, lean, look, step, shirt, dark, light, hx, hy });
              if (working && Math.abs(rt.torque) > 300) drawDust(x, y, lean, t, s + arm * 3);
            },
          });
        });
      }
    }
  }

  /** Un tiratore, piedi in (x, y): sette-nove pixel d'altezza. */
  function drawShooter(x, y, o) {
    const {
      pose, lean, look, step, shirt, dark, light, hx, hy,
    } = o;
    rect(x - 2, y, 5, 1, PAL.shadow);                                   // ombra
    if (pose === 'sotto') {
      // Accucciato: testa e schiena sotto il braccio.
      rect(x - 2, y - 3, 5, 3, shirt);
      rect(x - 2, y - 3, 5, 1, light);
      rect(x - 2 + (look > 0 ? 3 : 0), y - 5, 2, 2, PAL.skin);
      rect(x - 2, y - 1, 1, 1, PAL.legs);
      rect(x + 2, y - 1, 1, 1, PAL.legs);
      return;
    }
    const low = pose === 'brake' ? 1 : 0;
    const bent = pose === 'push' ? 1 : 0;
    // Gambe: a passo durante lo sforzo, larghe nel freno.
    if (pose === 'brake') {
      rect(x - 2, y - 2, 1, 2, PAL.legs);
      rect(x + 2, y - 2, 1, 2, PAL.legs);
    } else {
      rect(x - 1 + (step ? lean : 0), y - 3, 1, 3, PAL.legs);
      rect(x + 1 - (step ? 0 : lean), y - 3, 1, 3, PAL.legs);
    }
    // Busto, inclinato verso dove spinge (o tira).
    const bx = x - 1 + lean * (1 + bent);
    const by = y - 7 + low + bent;
    rect(bx, by, 3, 4, shirt);
    rect(bx, by, 3, 1, light);
    rect(bx + (lean < 0 ? 0 : 2), by + 3, 1, 1, dark);
    // Testa: avanti nella spinta, indietro nella tirata.
    const headX = bx + 1 + (pose === 'pull' ? -lean : lean) * (pose === 'idle' ? 0 : 1) - 1;
    rect(headX, by - 2, 2, 2, PAL.skin);
    rect(headX + (look > 0 ? 1 : 0), by - 2, 1, 1, PAL.skinLo);
    // Braccia al palo: una linea di pelle dalla spalla al timone.
    line(bx + 1, by + 1, hx, hy + 1, pose === 'pull' ? PAL.skin : PAL.skinLo, 1);
  }

  /** Polvere sollevata dai piedi quando si spinge o si tira con forza. */
  function drawDust(x, y, lean, t, seed) {
    const phase = (t / 90 + seed * 1.7) % 6;
    const dx = Math.round(-lean * (2 + phase));
    if (phase < 4) rect(x + dx, y - Math.floor(phase / 2), 1, 1, PAL.dust);
  }

  /**
   * Le bandiere in cima ai bracci: due per squadra, una per estremità. Quella
   * del braccio più vicino all'arco — il "palo" che conta adesso — è più alta,
   * più grande e ha la punta bianca.
   */
  function queueFlags(m, colors, t, front) {
    for (let i = 0; i < 2; i++) {
      const attivo = activeArm(m, i);
      for (const a of [paloAngle(m, i), paloAngle(m, i) + Math.PI]) {
        const isAttivo = Math.abs(normAngle(a - attivo)) < 1e-6;
        const X = Math.cos(a) * 1.02;
        const Y = Math.sin(a) * 1.02;
        front.push({
          z: sy(Y) + 0.3,
          draw() {
            const [x, y] = P(X, Y);
            const pole = Math.round((BEAM_H + (isAttivo ? 0.22 : 0.14)) * k * lift);
            line(x, y, x, y - pole, PAL.post, 1);
            const fw = isAttivo ? 6 : 4;
            const fh = isAttivo ? 4 : 3;
            const wave = Math.floor(t / 200 + i) % 2;
            for (let c = 0; c < fw; c++) {
              const yy = y - pole + (c % 2 === wave ? 0 : 1);
              rect(x + 1 + c, yy, 1, fh, c === fw - 1 && isAttivo ? '#ffffff' : colors[i]);
            }
            if (isAttivo) rect(x - 1, y - pole - 2, 3, 2, PAL.gold);
          },
        });
      }
    }
  }

  /**
   * Frecce a terra nel verso in cui ciascuna squadra fa girare il timone, lunghe
   * quanto la coppia: si legge al volo chi sta spingendo, e dove.
   */
  function drawArrows(m, colors) {
    for (let i = 0; i < 2; i++) {
      const rt = m.rt[i];
      if (Math.abs(rt.torque) < 1) continue;
      const mag = Math.min(1, Math.abs(rt.torque) / 2200);
      const dir = Math.sign(rt.torque);
      for (const arm of [0, 1]) {
        const a = paloAngle(m, i) + arm * Math.PI;
        const X = Math.cos(a) * 0.62;
        const Y = Math.sin(a) * 0.62;
        const tX = -Math.sin(a) * dir;
        const tY = Math.cos(a) * dir;
        const len = 0.1 + mag * 0.16;
        const [x0, y0] = P(X + tX * 0.08, Y + tY * 0.08);
        const [x1, y1] = P(X + tX * (0.08 + len), Y + tY * (0.08 + len));
        line(x0, y0, x1, y1, colors[i], 1);
        // Punta: due pixel ai lati della fine.
        const nx = -(y1 - y0);
        const ny = x1 - x0;
        const nl = Math.hypot(nx, ny) || 1;
        const bx = x1 - (x1 - x0) / (Math.hypot(x1 - x0, y1 - y0) || 1) * 2;
        const byy = y1 - (y1 - y0) / (Math.hypot(x1 - x0, y1 - y0) || 1) * 2;
        rect(bx + (nx / nl) * 1.5, byy + (ny / nl) * 1.5, 1, 1, colors[i]);
        rect(bx - (nx / nl) * 1.5, byy - (ny / nl) * 1.5, 1, 1, colors[i]);
      }
    }
  }

  /** Il pubblico: dietro la piazza prima di tutto, davanti per ultimo. */
  function drawCrowd(t, frontRow) {
    for (const p of crowd) {
      if ((p.Y > 0.15) !== frontRow) continue;
      const [x, y] = P(p.X, p.Y);
      const bob = Math.sin(t / 380 + p.phase) > 0.6 ? 1 : 0;
      rect(x - 1, y - 3 - bob, 3, 2, p.shirt);
      rect(x, y - 5 - bob, 1, 2, PAL.skin);
      rect(x - 1, y - 1, 1, 1, PAL.legs);
      rect(x + 1, y - 1, 1, 1, PAL.legs);
    }
  }

  resize();
  // Il riquadro cambia con la finestra ma anche con il resto della pagina (la
  // mano che compare, il pannello della battuta): lo si osserva direttamente.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
  else window.addEventListener('resize', resize);

  return {
    draw,
    resize,
    /** Smette di seguire il riquadro: da chiamare quando la tirata finisce. */
    destroy() { if (ro) ro.disconnect(); else window.removeEventListener('resize', resize); },
    /** Raggio della piazza in pixel di schermo (per chi volesse sovrapporre etichette). */
    get radius() { return ARENA_R * k * (canvas.getBoundingClientRect().width / W); },
  };
}

export { normAngle };
