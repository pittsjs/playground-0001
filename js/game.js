/**
 * game.js — Main game loop and state management.
 *
 * Ties together physics.js and renderer.js. Owns the game loop,
 * input handling, and the collection of table objects.
 *
 * Step 3: Real table shape with funnel walls, drain gap, plunger lane,
 * and a hold-to-charge launch mechanic.
 *
 * Controls:
 *   Z / Left Arrow  — left flipper
 *   X / Right Arrow — right flipper
 *   Space (hold)    — charge plunger, release to launch
 *   R               — reset ball to plunger
 */

(() => {
  "use strict";

  const canvas = document.getElementById("court");
  Renderer.init(canvas);

  const W = canvas.width;   // 480
  const H = canvas.height;  // 800

  /* ── Tuning constants ────────────────────────────────────── */

  const GRAVITY = 800;
  const BALL_RADIUS = 12;
  const WALL_BOUNCE = 0.55;
  const FLIPPER_BOUNCE = 0.35;
  const COLLISION_PASSES = 3;

  const PLUNGER_MAX_VEL = 1400;   // max upward launch speed (px/s)
  const PLUNGER_MIN_VEL = 300;    // minimum launch even on a quick tap
  const PLUNGER_CHARGE_RATE = 2.2; // fills from 0→1 in ~0.45s

  /* ── Table layout constants ──────────────────────────────── */
  // Main play area: x 30–410, plunger lane: x 420–460

  const LANE_LEFT = 410;
  const LANE_RIGHT = 460;
  const LANE_TOP = 200;    // separator starts low enough to leave a wide exit at top
  const LANE_BOTTOM = 770;
  const LANE_CENTER_X = (LANE_LEFT + LANE_RIGHT) / 2;  // 435

  const PLUNGER_BALL_X = LANE_CENTER_X;
  const PLUNGER_BALL_Y = LANE_BOTTOM - 30;  // 740

  /* ── Table walls ─────────────────────────────────────────── */

  const walls = [
    // Top wall (spans full width including lane)
    Physics.createWall(30, 30, 460, 30),

    // Left wall (straight section down to where the funnel starts)
    Physics.createWall(30, 30, 30, 630),

    // Left funnel (angles inward toward the flipper pocket)
    Physics.createWall(30, 630, 100, 740),

    // Left slingshot (short wall connecting funnel to flipper pivot area)
    Physics.createWall(100, 740, 130, 720),

    // Right slingshot (connects flipper pivot area to right funnel)
    Physics.createWall(310, 720, 340, 740),

    // Right funnel (angles inward from lane separator toward flipper pocket)
    Physics.createWall(340, 740, LANE_LEFT, 630),

    // Lane separator (divides main play area from plunger lane)
    Physics.createWall(LANE_LEFT, LANE_TOP, LANE_LEFT, LANE_BOTTOM),

    // Lane exit curve — two segments form a smooth bend that redirects
    // the ball from going straight up into curving left onto the table.
    Physics.createWall(LANE_LEFT, LANE_TOP, 400, 120),   // gentle initial bend
    Physics.createWall(400, 120, 345, 55),                // steeper section sends ball left

    // Right outer wall
    Physics.createWall(LANE_RIGHT, 30, LANE_RIGHT, LANE_BOTTOM),

    // Lane bottom wall
    Physics.createWall(LANE_RIGHT, LANE_BOTTOM, LANE_LEFT, LANE_BOTTOM),
  ];

  /* ── Flippers ────────────────────────────────────────────── */

  const FLIPPER_LEN = 80;
  const FLIPPER_REST = 0.42;

  const leftFlipper = Physics.createFlipper(130, 720, FLIPPER_LEN, FLIPPER_REST, -FLIPPER_REST);
  const rightFlipper = Physics.createFlipper(310, 720, FLIPPER_LEN, Math.PI - FLIPPER_REST, Math.PI + FLIPPER_REST);

  /* ── Ball + plunger state ────────────────────────────────── */

  let ball = Physics.createBall(PLUNGER_BALL_X, PLUNGER_BALL_Y, BALL_RADIUS);
  let plungerReady = true;     // ball is in the lane waiting to launch
  let plungerCharging = false;
  let plungerPower = 0;

  function resetToPlunger() {
    ball = Physics.createBall(PLUNGER_BALL_X, PLUNGER_BALL_Y, BALL_RADIUS);
    plungerReady = true;
    plungerCharging = false;
    plungerPower = 0;
  }

  /* ── Input ───────────────────────────────────────────────── */

  const keys = {};

  document.addEventListener("keydown", (e) => {
    keys[e.code] = true;

    if (e.code === "Space") {
      e.preventDefault();
      if (plungerReady && !plungerCharging) {
        plungerCharging = true;
        plungerPower = 0;
      }
    }

    if (e.code === "KeyR") {
      resetToPlunger();
    }
  });

  document.addEventListener("keyup", (e) => {
    keys[e.code] = false;

    if (e.code === "Space" && plungerCharging) {
      // Launch the ball
      const power = Math.max(plungerPower, PLUNGER_MIN_VEL / PLUNGER_MAX_VEL);
      ball.vel = { x: 0, y: -power * PLUNGER_MAX_VEL };
      plungerReady = false;
      plungerCharging = false;
      plungerPower = 0;
    }
  });

  function leftFlipperActive() { return keys["KeyZ"] || keys["ArrowLeft"]; }
  function rightFlipperActive() { return keys["KeyX"] || keys["ArrowRight"]; }

  /* ── Responsive canvas sizing ────────────────────────────── */

  function resize() {
    const ratio = W / H;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ── Game loop ───────────────────────────────────────────── */

  let lastTs = 0;

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.03);
    lastTs = ts;

    // --- Charge plunger ---
    if (plungerCharging) {
      plungerPower = Math.min(1, plungerPower + PLUNGER_CHARGE_RATE * dt);
    }

    // --- Flippers ---
    Physics.updateFlipper(leftFlipper, leftFlipperActive(), dt);
    Physics.updateFlipper(rightFlipper, rightFlipperActive(), dt);

    // --- Ball physics (skip if ball is sitting in the plunger) ---
    if (!plungerReady || plungerCharging) {
      Physics.updateBall(ball, GRAVITY, dt);
    }

    // --- Collisions ---
    for (let i = 0; i < COLLISION_PASSES; i++) {
      for (const wall of walls) Physics.collideBallWall(ball, wall, WALL_BOUNCE);
      Physics.collideBallFlipper(ball, leftFlipper, FLIPPER_BOUNCE);
      Physics.collideBallFlipper(ball, rightFlipper, FLIPPER_BOUNCE);
    }

    // --- Drain detection: ball fell below the table ---
    if (ball.pos.y > H + 30) {
      resetToPlunger();
    }

    // --- Once ball leaves the plunger lane, it's in play ---
    if (!plungerReady && ball.pos.x < LANE_LEFT) {
      // Ball has entered main play area (one-way transition for this launch)
    }

    // --- Render ---
    Renderer.clear();
    Renderer.drawLane(LANE_LEFT, LANE_RIGHT, 30, LANE_BOTTOM);
    for (const wall of walls) Renderer.drawWall(wall);
    Renderer.drawFlipper(leftFlipper, leftFlipperActive());
    Renderer.drawFlipper(rightFlipper, rightFlipperActive());
    Renderer.drawBall(ball);

    if (plungerReady) {
      Renderer.drawPlunger(PLUNGER_BALL_X, PLUNGER_BALL_Y + BALL_RADIUS + 4, plungerPower, plungerCharging);
    }

    // Hint text
    if (plungerReady && !plungerCharging) {
      Renderer.drawHint("Hold SPACE to charge, release to launch");
    } else if (plungerReady && plungerCharging) {
      Renderer.drawHint("Release SPACE to launch!");
    } else {
      Renderer.drawHint("Z / \u2190 = Left flipper  |  X / \u2192 = Right flipper  |  R = Reset");
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
})();
