/**
 * game.js — Main game loop and state management.
 *
 * Ties together physics.js and renderer.js. Owns the game loop,
 * input handling, and the collection of table objects.
 *
 * Step 4: Expanded board (600×1000), circular bumpers, and hoop targets.
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

  const W = canvas.width;   // 600
  const H = canvas.height;  // 1000

  /* ── Tuning constants ────────────────────────────────────── */

  const GRAVITY       = 800;
  const BALL_RADIUS   = 12;
  const WALL_BOUNCE   = 0.55;
  const FLIPPER_BOUNCE = 0.35;
  const BUMPER_BOUNCE  = 1.2;   // active bumpers inject energy on hit
  const HOOP_BOUNCE    = 0.8;   // moderate bounce off hoop rim
  const COLLISION_PASSES = 3;
  const MAX_SUBSTEP = 0.005;  // prevents fast ball from tunneling through walls

  const PLUNGER_MAX_VEL    = 2200;  // scaled up for taller table
  const PLUNGER_MIN_VEL    = 900;
  const PLUNGER_CHARGE_RATE = 2.0;

  /* ── Table layout ──────────────────────────────────────────
   *
   *  Main play area : x 40 → 515  (475 px wide)
   *  Plunger lane   : x 515 → 565 at the bottom, but the
   *  curve is now looser so the lane stays wider for longer
   *  instead of pinching in the middle.
   *
   *  The lane separator starts at LANE_TOP, leaving a gap
   *  at the top for the ball to exit the guide-rail curve.
   * ───────────────────────────────────────────────────────── */

  const LANE_LEFT   = 515;
  const LANE_RIGHT  = 565;
  const LANE_TOP    = 260;
  const LANE_BOTTOM = 960;

  const PLUNGER_BALL_X = LANE_RIGHT - BALL_RADIUS - 3;  // hug right wall
  const PLUNGER_BALL_Y = LANE_BOTTOM - 30;

  /* ── Table walls ───────────────────────────────────────────── */

  const walls = [
    // Top wall (covers the main area only)
    Physics.createWall(40, 40, 505, 40),

    // Left wall (straight down to where the funnel begins)
    Physics.createWall(40, 40, 40, 790),

    // Left funnel — guides the ball toward the left flipper
    Physics.createWall(40, 790, 150, 890),

    // Right funnel — guides the ball toward the right flipper
    Physics.createWall(400, 890, LANE_LEFT, 790),

    // Lane separator (divides play area from plunger lane)
    Physics.createWall(LANE_LEFT, LANE_TOP, LANE_LEFT, LANE_BOTTOM),

    // Right outer wall — multi-segment guide-rail curve.
    // The ball launches along this wall and rides it leftward into play.
    // These points were nudged outward a bit so the lane is not so tight.
    Physics.createWall(LANE_RIGHT, LANE_BOTTOM, LANE_RIGHT, 650),  // straight lower
    Physics.createWall(LANE_RIGHT, 650, 565, 450),                 // gentle bend (wider)
    Physics.createWall(565, 450, 545, 280),                        // tighter, still roomy
    Physics.createWall(545, 280, 520, 150),                        // above separator region
    Physics.createWall(520, 150, 475, 60),                         // nearing top
    Physics.createWall(475, 60, 440, 42),                          // exits into play

    // Lane bottom wall
    Physics.createWall(LANE_RIGHT, LANE_BOTTOM, LANE_LEFT, LANE_BOTTOM),
  ];

  /* ── Flippers ──────────────────────────────────────────────── */

  const FLIPPER_LEN  = 95;
  const FLIPPER_REST = 0.42;  // radians from horizontal

  const leftFlipper = Physics.createFlipper(
    165, 900, FLIPPER_LEN, FLIPPER_REST, -FLIPPER_REST
  );
  const rightFlipper = Physics.createFlipper(
    390, 900, FLIPPER_LEN,
    Math.PI - FLIPPER_REST, Math.PI + FLIPPER_REST
  );

  /* ── Bumpers (inverted triangle in upper-mid zone) ─────────
   *
   *      ⊛           ⊛      ← top pair at y ≈ 350
   *           ⊛              ← bottom center at y ≈ 480
   * ───────────────────────────────────────────────────────── */

  const bumpers = [
    { x: 200, y: 350, radius: 25, lastHit: 0 },
    { x: 350, y: 350, radius: 25, lastHit: 0 },
    { x: 275, y: 480, radius: 25, lastHit: 0 },
  ];

  /* ── Hoops (basketball-hoop targets) ───────────────────────
   *
   *  Top-center hoop sits right where the ball enters from the
   *  guide rail — a prime target for skilled launches.
   *  Side hoops reward flipper accuracy.
   * ───────────────────────────────────────────────────────── */

  const hoops = [
    { x: 275, y: 150, radius: 22, lastHit: 0 },   // center-top
    { x: 120, y: 580, radius: 20, lastHit: 0 },   // left side
    { x: 430, y: 580, radius: 20, lastHit: 0 },   // right side
  ];

  /* ── Ball + plunger state ──────────────────────────────────── */

  let ball = Physics.createBall(PLUNGER_BALL_X, PLUNGER_BALL_Y, BALL_RADIUS);
  let plungerReady    = true;
  let plungerCharging = false;
  let plungerPower    = 0;
  let ballInPlay      = false;

  // One-way gate: extends the separator up to the top wall.
  // Activated only after the ball enters play (blocks re-entry).
  const gateWall = Physics.createWall(LANE_LEFT, 40, LANE_LEFT, LANE_TOP);

  function resetToPlunger() {
    ball = Physics.createBall(PLUNGER_BALL_X, PLUNGER_BALL_Y, BALL_RADIUS);
    plungerReady    = true;
    plungerCharging = false;
    plungerPower    = 0;
    ballInPlay      = false;
  }

  /* ── Input ─────────────────────────────────────────────────── */

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
      const power = Math.max(plungerPower, PLUNGER_MIN_VEL / PLUNGER_MAX_VEL);
      ball.vel = { x: 0, y: -power * PLUNGER_MAX_VEL };
      plungerReady    = false;
      plungerCharging = false;
      plungerPower    = 0;
    }
  });

  function leftFlipperActive()  { return keys["KeyZ"] || keys["ArrowLeft"]; }
  function rightFlipperActive() { return keys["KeyX"] || keys["ArrowRight"]; }

  /* ── Responsive canvas sizing ──────────────────────────────── */

  function resize() {
    const ratio = W / H;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ── Game loop ─────────────────────────────────────────────── */

  let lastTs = 0;

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.03);
    lastTs = ts;

    // --- Charge plunger ---
    if (plungerCharging) {
      plungerPower = Math.min(1, plungerPower + PLUNGER_CHARGE_RATE * dt);
    }

    // --- Physics sub-stepping: run in small steps so a fast ball
    //     never moves more than ~1 radius per step, preventing
    //     tunneling through walls ---
    let remaining = dt;
    while (remaining > 0.0001) {
      const subDt = Math.min(remaining, MAX_SUBSTEP);
      remaining -= subDt;

      // --- Flippers ---
      Physics.updateFlipper(leftFlipper, leftFlipperActive(), subDt);
      Physics.updateFlipper(rightFlipper, rightFlipperActive(), subDt);

      // --- Ball physics (skip while ball sits idle in the plunger) ---
      if (!plungerReady || plungerCharging) {
        Physics.updateBall(ball, GRAVITY, subDt);
      }

      // --- Track when the ball first enters the main play area ---
      if (!ballInPlay && !plungerReady && ball.pos.x < LANE_LEFT - BALL_RADIUS) {
        ballInPlay = true;
      }

      // --- Collisions (multiple passes for stability) ---
      for (let i = 0; i < COLLISION_PASSES; i++) {
        for (const wall of walls) {
          Physics.collideBallWall(ball, wall, WALL_BOUNCE);
        }

        Physics.collideBallFlipper(ball, leftFlipper, FLIPPER_BOUNCE);
        Physics.collideBallFlipper(ball, rightFlipper, FLIPPER_BOUNCE);

        for (const bumper of bumpers) {
          if (Physics.collideBallCircle(ball, bumper, BUMPER_BOUNCE)) {
            bumper.lastHit = ts;
          }
        }

        for (const hoop of hoops) {
          if (Physics.collideBallCircle(ball, hoop, HOOP_BOUNCE)) {
            hoop.lastHit = ts;
          }
        }

        // One-way gate blocks re-entry into the plunger lane
        if (ballInPlay) {
          Physics.collideBallWall(ball, gateWall, WALL_BOUNCE);
        }
      }
    }

    // --- Escape detection: ball left the table (top, bottom, or sides) ---
    if (ball.pos.y > H + 30 || ball.pos.y < -30 || ball.pos.x < -30 || ball.pos.x > W + 30) {
      resetToPlunger();
    }

    // --- Render ---
    Renderer.clear();
    Renderer.drawLane(LANE_LEFT, LANE_RIGHT, 40, LANE_BOTTOM);

    for (const wall of walls) Renderer.drawWall(wall);
    for (const hoop of hoops) Renderer.drawHoop(hoop, ts);
    for (const bumper of bumpers) Renderer.drawBumper(bumper, ts);

    Renderer.drawFlipper(leftFlipper, leftFlipperActive());
    Renderer.drawFlipper(rightFlipper, rightFlipperActive());
    Renderer.drawBall(ball);

    if (plungerReady) {
      Renderer.drawPlunger(
        PLUNGER_BALL_X,
        PLUNGER_BALL_Y + BALL_RADIUS + 4,
        plungerPower,
        plungerCharging
      );
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
