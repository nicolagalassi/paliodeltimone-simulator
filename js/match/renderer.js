/**
 * Disegno del campo su canvas 2D.
 *
 * Convenzione: l'angolo θ è misurato come in canvas (x = cos, y = sin, con y
 * verso il basso), quindi θ crescente ruota in senso orario sullo schermo.
 */

import { TUNING, paloAngle, normAngle, activeArm, distanceToZone, teamInZone } from './engine.js';

const TAU = Math.PI * 2;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2;
    cy = H / 2;
    R = Math.min(W, H) / 2 - 14;
  }

  function draw(m, colors, t = 0) {
    ctx.clearRect(0, 0, W, H);
    drawField();
    drawZone(m, t);
    drawArrows(m, colors);
    drawTimone(m, colors);
    drawShooters(m, colors);
    drawPali(m, colors);
  }

  /* ---- campo ---- */
  function drawField() {
    const g = ctx.createRadialGradient(cx, cy - R * 0.25, R * 0.1, cx, cy, R);
    g.addColorStop(0, '#3a3226');
    g.addColorStop(1, '#241f18');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5c4f3a';
    ctx.stroke();

    // Cerchio interno di riferimento, aiuta a leggere la rotazione.
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.55, 0, TAU);
    ctx.strokeStyle = 'rgba(242, 223, 168, 0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ---- zona palio ---- */
  function drawZone(m, t) {
    const a0 = TUNING.ZONE_CENTER - TUNING.ZONE_HALF;
    const a1 = TUNING.ZONE_CENTER + TUNING.ZONE_HALF;
    const occupied = teamInZone(m, 0) || teamInZone(m, 1);
    const pulse = occupied ? 0.6 + 0.4 * Math.sin(t * 0.012) : 0.32;

    ctx.beginPath();
    ctx.arc(cx, cy, R - 7, a0, a1);
    ctx.lineWidth = 16;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = `rgba(233, 30, 120, ${pulse})`;
    ctx.stroke();

    if (occupied) {
      ctx.save();
      ctx.shadowColor = 'rgba(233, 30, 120, 0.9)';
      ctx.shadowBlur = 24;
      ctx.stroke();
      ctx.restore();
    }

    // Tacche ai bordi dell'arco.
    for (const a of [a0, a1]) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18));
      ctx.lineTo(cx + Math.cos(a) * (R + 3), cy + Math.sin(a) * (R + 3));
      ctx.strokeStyle = 'rgba(255, 150, 200, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /* ---- croce del timone ---- */
  function drawTimone(m, colors) {
    const arm = R * 0.86;
    const w = Math.max(9, R * 0.055);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(m.theta);

    ctx.fillStyle = '#f2dfa8';
    ctx.strokeStyle = 'rgba(120, 96, 50, 0.8)';
    ctx.lineWidth = 1.5;
    // Due assi incrociati: quello orizzontale locale appartiene alla squadra A.
    roundRect(-arm, -w / 2, arm * 2, w, w * 0.35);
    roundRect(-w / 2, -arm, w, arm * 2, w * 0.35);

    ctx.restore();

    // Perno centrale.
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(10, R * 0.055), 0, TAU);
    ctx.fillStyle = '#0d0b09';
    ctx.fill();
    ctx.strokeStyle = '#5c4f3a';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /**
   * Le quattro estremità della croce: due per squadra, opposte fra loro.
   * Entrambe valgono — la Zona Palio conta il braccio più vicino — quindi
   * vanno mostrate entrambe, con in evidenza quella che in questo momento
   * fa da palo per la squadra.
   */
  function drawPali(m, colors) {
    const arm = R * 0.86;
    for (let i = 0; i < 2; i++) {
      const attivo = activeArm(m, i);
      for (const a of [paloAngle(m, i), paloAngle(m, i) + Math.PI]) {
        const isAttivo = Math.abs(normAngle(a - attivo)) < 1e-6;
        markPalo(cx + Math.cos(a) * arm, cy + Math.sin(a) * arm, colors[i], isAttivo);
      }
    }
  }

  /**
   * L'estremità del braccio da portare in Zona Palio. Va distinta a colpo
   * d'occhio dai tiratori, che hanno lo stesso colore: un anello chiaro e
   * spesso attorno a un nucleo pieno. L'estremità non attiva resta visibile
   * ma spenta, cos\u00ec si legge quale delle due sta puntando all'arco.
   */
  function markPalo(x, y, color, attivo) {
    const rr = Math.max(8, R * 0.042) * (attivo ? 1 : 0.72);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.fillStyle = color;
    ctx.globalAlpha = attivo ? 1 : 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = attivo ? '#fff' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = attivo ? 3.5 : 2;
    ctx.stroke();

    if (attivo) {
      ctx.beginPath();
      ctx.arc(x, y, rr * 0.38, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /* ---- tiratori ----
   * I sei tiratori di una squadra stanno su due bracci opposti e devono
   * produrre coppia nello stesso verso: la loro disposizione è quindi
   * ROTAZIONALMENTE simmetrica (ruotata di 180°), non specchiata. Specchiarla
   * — l'errore che avevo commesso — li mette sullo stesso lato in coordinate
   * assolute e li fa sembrare intenti a remarsi contro.
   */
  function drawShooters(m, colors) {
    const rr = Math.max(9, R * 0.052);
    for (let i = 0; i < 2; i++) {
      const rt = m.rt[i];
      const base = paloAngle(m, i);
      const passing = rt.sottoTimer > 0;

      for (let k = 0; k < 6; k++) {
        const armIndex = k < 3 ? 0 : 1;            // due bracci opposti
        const slot = k % 3;
        const angle = base + armIndex * Math.PI;
        const dRad = R * (0.42 + slot * 0.19);

        // Versore tangente al braccio nel verso della rotazione positiva.
        const ax = Math.cos(angle);
        const ay = Math.sin(angle);
        const tx = -ay;
        const ty = ax;

        // I tiratori stanno dietro rispetto al verso in cui guardano: durante
        // il passaggio sotto il palo si trovano a cavallo del braccio.
        const off = -rt.facing * rr * 1.15 * (passing ? 0 : 1);
        const px = cx + ax * dRad + tx * off;
        const py = cy + ay * dRad + ty * off;

        ctx.beginPath();
        ctx.arc(px, py, rr, 0, TAU);
        ctx.fillStyle = colors[i];
        ctx.globalAlpha = passing ? 0.45 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.stroke();

        // Tacca sul lato verso cui il tiratore guarda: rende leggibile
        // l'orientamento della squadra, da cui dipende cosa fanno spinta e tirata.
        if (!passing) {
          ctx.beginPath();
          ctx.moveTo(px + tx * rt.facing * rr * 0.35, py + ty * rt.facing * rr * 0.35);
          ctx.lineTo(px + tx * rt.facing * rr * 0.95, py + ty * rt.facing * rr * 0.95);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // Barra di fatica sotto il primo tiratore di ogni braccio.
        if (slot === 0) {
          const bw = rr * 2;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(px - rr, py + rr + 3, bw, 3);
          ctx.fillStyle = rt.stamina > 0.3 ? '#f2dfa8' : '#d9534f';
          ctx.fillRect(px - rr, py + rr + 3, bw * rt.stamina, 3);
        }
      }
    }
  }

  /* ---- frecce di spinta ---- */
  function drawArrows(m, colors) {
    for (let i = 0; i < 2; i++) {
      const rt = m.rt[i];
      if (Math.abs(rt.torque) < 1) continue;
      const mag = Math.min(1, Math.abs(rt.torque) / 2200);
      const dir = Math.sign(rt.torque);
      const base = paloAngle(m, i);

      for (const armIndex of [0, 1]) {
        const a = base + armIndex * Math.PI;
        const rad = R * 0.72;
        const ox = cx + Math.cos(a) * rad;
        const oy = cy + Math.sin(a) * rad;
        // Tangente al cerchio, nel verso della coppia applicata.
        const tx = -Math.sin(a) * dir;
        const ty = Math.cos(a) * dir;
        drawArrow(ox, oy, tx, ty, 22 + mag * 40, colors[i], 0.35 + mag * 0.5);
      }
    }
  }

  function drawArrow(x, y, dx, dy, len, color, alpha) {
    const ex = x + dx * len;
    const ey = y + dy * len;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    const head = 9;
    const nx = -dy, ny = dx;
    ctx.beginPath();
    ctx.moveTo(ex + dx * head, ey + dy * head);
    ctx.lineTo(ex + nx * head * 0.6, ey + ny * head * 0.6);
    ctx.lineTo(ex - nx * head * 0.6, ey - ny * head * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  resize();
  window.addEventListener('resize', resize);

  return { draw, resize, get radius() { return R; } };
}

export { normAngle };
