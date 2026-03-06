/**
 * renderer.js — Canvas drawing for the pinball table.
 *
 * Exposes one global:
 *   Renderer — init the canvas, then call draw functions each frame.
 *
 * Drawing is split into small functions so new elements (bumpers, hoops,
 * flippers, HUD) can be added in later steps without touching existing code.
 */

const Renderer = (() => {
  let canvas, ctx, W, H;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    W = canvas.width;
    H = canvas.height;
  }

  /* ── Background ──────────────────────────────────────────── */

  /** Dark radial gradient that gives the table a subtle spotlight feel. */
  function clear() {
    const grd = ctx.createRadialGradient(W / 2, H / 3, 60, W / 2, H / 2, H);
    grd.addColorStop(0, "#1e1535");
    grd.addColorStop(1, "#0d0a18");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  }

  /* ── Walls ───────────────────────────────────────────────── */

  /** Draw a wall segment as a faint glowing line. */
  function drawWall(wall) {
    ctx.beginPath();
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
    ctx.strokeStyle = "rgba(120, 160, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ── Ball ─────────────────────────────────────────────────── */

  /** Draw the basketball with gradient, outline, and seam lines. */
  function drawBall(ball) {
    const { x, y } = ball.pos;
    const r = ball.radius;

    // Drop shadow
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 2, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fill();

    // Ball body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    g.addColorStop(0, "#ffaa33");
    g.addColorStop(1, "#cc6600");
    ctx.fillStyle = g;
    ctx.fill();

    // Outline
    ctx.strokeStyle = "#8B4513";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Seam lines (the cross pattern on a basketball)
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.strokeStyle = "rgba(139, 69, 19, 0.4)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  /* ── Flippers ─────────────────────────────────────────────── */

  /**
   * Draw a flipper as a tapered paddle shape (wider at pivot, narrower at tip).
   * Color shifts slightly when the flipper is active (swung up).
   */
  function drawFlipper(flipper, active) {
    const seg = Physics.getFlipperSegment(flipper);
    const dir = Vec.normalize(Vec.sub({ x: seg.x2, y: seg.y2 }, { x: seg.x1, y: seg.y1 }));
    const perp = { x: -dir.y, y: dir.x };

    const pivotHalf = 12;  // half-width at the pivot end
    const tipHalf = 6;     // half-width at the tip end

    // Tapered quadrilateral
    ctx.beginPath();
    ctx.moveTo(seg.x1 + perp.x * pivotHalf, seg.y1 + perp.y * pivotHalf);
    ctx.lineTo(seg.x2 + perp.x * tipHalf,   seg.y2 + perp.y * tipHalf);
    ctx.lineTo(seg.x2 - perp.x * tipHalf,   seg.y2 - perp.y * tipHalf);
    ctx.lineTo(seg.x1 - perp.x * pivotHalf, seg.y1 - perp.y * pivotHalf);
    ctx.closePath();

    ctx.fillStyle = active ? "#8a7aff" : "#6a5aff";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pivot dot
    ctx.beginPath();
    ctx.arc(flipper.pivot.x, flipper.pivot.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#aaa";
    ctx.fill();
  }

  /* ── Plunger lane ─────────────────────────────────────────── */

  /** Shade the plunger lane area so it's visually distinct from the main table. */
  function drawLane(left, right, top, bottom) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.fillRect(left, top, right - left, bottom - top);
  }

  /**
   * Draw the plunger mechanism at the bottom of the lane.
   * Shows a spring-like bar that compresses as power increases.
   */
  function drawPlunger(x, y, power, charging) {
    const barW = 30;
    const maxTravel = 40;   // how far the plunger compresses
    const travel = power * maxTravel;

    // Plunger bar (moves up as power increases, compressing the "spring")
    const barY = y + travel;
    ctx.fillStyle = charging ? "#ff8c00" : "#888";
    ctx.fillRect(x - barW / 2, barY, barW, 8);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - barW / 2, barY, barW, 8);

    // Spring lines between ball and bar
    const springTop = y - 8;
    const springBot = barY;
    const segments = 6;
    if (springBot > springTop) {
      ctx.beginPath();
      ctx.moveTo(x, springTop);
      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const sy = springTop + t * (springBot - springTop);
        const sx = x + (i % 2 === 0 ? -6 : 6);
        ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = charging ? "rgba(255, 140, 0, 0.5)" : "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Power meter (small bar to the right of the plunger)
    if (charging) {
      const meterH = 60;
      const meterX = x + barW / 2 + 6;
      const meterY = y - 10;

      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(meterX, meterY, 6, meterH);

      const fill = power * meterH;
      const color = power < 0.4 ? "#ffd166" : power < 0.75 ? "#4caf50" : "#ff5d7a";
      ctx.fillStyle = color;
      ctx.fillRect(meterX, meterY + meterH - fill, 6, fill);
    }
  }

  /* ── Bumpers ──────────────────────────────────────────────── */

  /**
   * Draw a circular bumper with a gradient fill, glow ring, and
   * an expanding ripple that plays for 200 ms after the ball hits it.
   */
  function drawBumper(bumper, now) {
    const { x, y, radius, lastHit } = bumper;
    const hitAge = now - lastHit;
    const flashing = lastHit > 0 && hitAge < 200;

    // Outer glow
    ctx.beginPath();
    ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = flashing
      ? "rgba(255, 100, 200, 0.35)"
      : "rgba(120, 80, 255, 0.12)";
    ctx.fill();

    // Body gradient
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, 2, x, y, radius
    );
    if (flashing) {
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#ff66cc");
    } else {
      g.addColorStop(0, "#c084fc");
      g.addColorStop(1, "#7c3aed");
    }
    ctx.fillStyle = g;
    ctx.fill();

    // Ring outline
    ctx.strokeStyle = flashing
      ? "rgba(255, 255, 255, 0.8)"
      : "rgba(200, 160, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Hit ripple (expanding ring that fades out)
    if (flashing) {
      const t = hitAge / 200;
      const rippleR = radius + t * 20;
      ctx.beginPath();
      ctx.arc(x, y, rippleR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 100, 200, ${1 - t})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /* ── Hoops ─────────────────────────────────────────────────── */

  /**
   * Draw a basketball hoop target: backboard, orange rim, net lines.
   * Glows gold for 300 ms after being hit.
   */
  function drawHoop(hoop, now) {
    const { x, y, radius, lastHit } = hoop;
    const hitAge = now - lastHit;
    const flashing = lastHit > 0 && hitAge < 300;

    // Hit glow (behind everything)
    if (flashing) {
      const t = hitAge / 300;
      ctx.beginPath();
      ctx.arc(x, y, radius + 12, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 215, 0, ${0.3 * (1 - t)})`;
      ctx.fill();
    }

    // Backboard (small rectangle above the rim)
    const boardW = radius * 1.6;
    const boardH = 5;
    ctx.fillStyle = flashing ? "#ffd700" : "rgba(255, 255, 255, 0.6)";
    ctx.fillRect(x - boardW / 2, y - radius - boardH - 2, boardW, boardH);

    // Rim (thick orange circle)
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = flashing ? "#ffd700" : "#ff6b35";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Net lines (simple drooping V-shapes inside the rim)
    ctx.strokeStyle = flashing
      ? "rgba(255, 215, 0, 0.6)"
      : "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    const netBottom = y + radius * 0.7;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x + i * radius * 0.5, y + radius * 0.3);
      ctx.lineTo(x + i * radius * 0.3, netBottom);
      ctx.stroke();
    }
  }

  /* ── Text helpers ─────────────────────────────────────────── */

  /** Draw a small hint string near the bottom of the canvas. */
  function drawHint(text) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, 12, H - 8);
  }

  /* ── Public API ───────────────────────────────────────────── */

  return {
    init,
    clear,
    drawWall,
    drawBall,
    drawFlipper,
    drawBumper,
    drawHoop,
    drawLane,
    drawPlunger,
    drawHint,
    ctx: () => ctx,
    width: () => W,
    height: () => H,
  };
})();
