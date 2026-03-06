/**
 * game.js — Main game loop and state management.
 *
 * Ties together physics.js and renderer.js. Owns the game loop,
 * input handling, and the collection of table objects.
 *
 * Step 7: Visual polish — ball trail, hit particles, screen flash, glow.
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

  // Scoring + game flow
  const BUMPER_POINTS = 50;
  const HOOP_POINTS = 250;
  const RAMP_POINTS = 500;
  const HIT_SCORE_COOLDOWN = 120; // ms between scoring from the same object

  const BALLS_PER_GAME = 3;

  // Combo: each scoring hit within COMBO_TIMEOUT adds to combo; multiplier scales.
  const COMBO_TIMEOUT = 2000;       // ms without a hit resets combo
  const COMBO_MULTIPLIER_PER_HIT = 0.25;  // 1x, 1.25x, 1.5x, 1.75x, 2x...
  const COMBO_CAP = 5;             // max combo hits (2.25x at 5)

  // On Fire: triggered after ON_FIRE_TRIGGER hits in a row; lasts ON_FIRE_DURATION ms.
  const ON_FIRE_TRIGGER = 3;
  const ON_FIRE_DURATION = 5000;
  const ON_FIRE_SCORE_MULT = 2;    // 2x points while on fire

  const STATE = {
    READY: "ready",      // ball waiting in plunger, launch to start / next ball
    LIVE: "live",        // ball is in play
    GAME_OVER: "gameover",
  };

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

  /* ── Ramp targets (high-value scoops) ─────────────────────────
   *  No guide walls — those created trapping pockets. Ball reaches
   *  them by bouncing off bumpers and flippers.
   */
  const RAMP_BOUNCE = 0.6;
  const ramps = [
    { x: 145, y: 455, radius: 28, lastHit: 0 },   // left ramp scoop
    { x: 410, y: 455, radius: 28, lastHit: 0 },   // right ramp scoop
  ];

  /* ── Ball + plunger + score state ──────────────────────────── */

  let ball = Physics.createBall(PLUNGER_BALL_X, PLUNGER_BALL_Y, BALL_RADIUS);
  let plungerReady    = true;
  let plungerCharging = false;
  let plungerPower    = 0;
  let ballInPlay      = false;

  let score = 0;
  let ballsRemaining = BALLS_PER_GAME;
  let highScore = 0;
  let gameState = STATE.READY;

  // Combo: consecutive scoring hits within COMBO_TIMEOUT
  let lastComboHitTime = 0;
  let comboCount = 0;
  // On Fire: active when ts < onFireUntil (set after COMBO_TRIGGER hits)
  let onFireUntil = 0;

  // Visual polish: ball trail (last N positions) and particles
  const BALL_TRAIL_LEN = 12;
  const ballTrail = [];
  const particles = [];
  let screenFlashUntil = 0;  // brief flash when On Fire triggers

  // Load high score from localStorage if available (non-fatal if it fails).
  try {
    const stored = localStorage.getItem("basketballPinballHighScore");
    if (stored) highScore = parseInt(stored, 10) || 0;
  } catch {
    highScore = 0;
  }

  // One-way gate: extends the separator up to the top wall.
  // Activated only after the ball enters play (blocks re-entry).
  const gateWall = Physics.createWall(LANE_LEFT, 40, LANE_LEFT, LANE_TOP);

  function resetToPlunger() {
    ball = Physics.createBall(PLUNGER_BALL_X, PLUNGER_BALL_Y, BALL_RADIUS);
    plungerReady    = true;
    plungerCharging = false;
    plungerPower    = 0;
    ballInPlay      = false;
    ballTrail.length = 0;
  }

  /** Spawn burst particles at (x, y) for scoring hits. */
  function spawnParticles(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 80 + Math.random() * 120;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 1,
        color,
      });
    }
  }

  /** Update particles: move and decay. */
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 2.5;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function persistHighScore() {
    try {
      localStorage.setItem("basketballPinballHighScore", String(highScore));
    } catch {
      // ignore storage errors
    }
  }

  function maybeUpdateHighScore() {
    if (score > highScore) {
      highScore = score;
      persistHighScore();
    }
  }

  function startNewGame() {
    score = 0;
    ballsRemaining = BALLS_PER_GAME;
    gameState = STATE.READY;
    lastComboHitTime = 0;
    comboCount = 0;
    onFireUntil = 0;
    resetToPlunger();
  }

  /** Add points with combo and On Fire multipliers; updates combo state. */
  function addScore(basePoints, ts) {
    if (ts - lastComboHitTime > COMBO_TIMEOUT) comboCount = 0;
    let mult = 1 + Math.min(comboCount, COMBO_CAP) * COMBO_MULTIPLIER_PER_HIT;
    if (ts < onFireUntil) mult *= ON_FIRE_SCORE_MULT;
    score += Math.round(basePoints * mult);
    comboCount += 1;
    lastComboHitTime = ts;
    if (comboCount >= ON_FIRE_TRIGGER) {
      onFireUntil = ts + ON_FIRE_DURATION;
      screenFlashUntil = ts + 250;
    }
  }

  function loseBall() {
    if (gameState === STATE.GAME_OVER) return;

    ballsRemaining -= 1;
    comboCount = 0;
    onFireUntil = 0;
    if (ballsRemaining > 0) {
      gameState = STATE.READY;
      resetToPlunger();
    } else {
      gameState = STATE.GAME_OVER;
      maybeUpdateHighScore();
      resetToPlunger();
    }
  }

  /* ── Input ─────────────────────────────────────────────────── */

  const keys = {};

  document.addEventListener("keydown", (e) => {
    keys[e.code] = true;

    if (e.code === "Space") {
      e.preventDefault();
      if (gameState === STATE.GAME_OVER) {
        // Space from game over starts a fresh game.
        startNewGame();
      }
      if (plungerReady && !plungerCharging) {
        plungerCharging = true;
        plungerPower = 0;
      }
    }

    if (e.code === "KeyR") {
      // R is a hard restart: new game with full balls.
      startNewGame();
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
      gameState = STATE.LIVE;
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
            if (gameState === STATE.LIVE && ts - bumper.lastHit > HIT_SCORE_COOLDOWN) {
              addScore(BUMPER_POINTS, ts);
              spawnParticles(bumper.x, bumper.y, "255,100,200");
            }
            bumper.lastHit = ts;
          }
        }

        for (const hoop of hoops) {
          if (Physics.collideBallCircle(ball, hoop, HOOP_BOUNCE)) {
            if (gameState === STATE.LIVE && ts - hoop.lastHit > HIT_SCORE_COOLDOWN) {
              addScore(HOOP_POINTS, ts);
              spawnParticles(hoop.x, hoop.y, "255,215,0");
            }
            hoop.lastHit = ts;
          }
        }

        for (const ramp of ramps) {
          if (Physics.collideBallCircle(ball, ramp, RAMP_BOUNCE)) {
            if (gameState === STATE.LIVE && ts - ramp.lastHit > HIT_SCORE_COOLDOWN) {
              addScore(RAMP_POINTS, ts);
              spawnParticles(ramp.x, ramp.y, "255,184,50");
            }
            ramp.lastHit = ts;
          }
        }

        // One-way gate blocks re-entry into the plunger lane
        if (ballInPlay) {
          Physics.collideBallWall(ball, gateWall, WALL_BOUNCE);
        }
      }
    }

    // --- Ball trail (when in play) ---
    if (ballInPlay && !plungerReady) {
      ballTrail.push({ x: ball.pos.x, y: ball.pos.y });
      if (ballTrail.length > BALL_TRAIL_LEN) ballTrail.shift();
    }

    // --- Particles ---
    updateParticles(dt);

    // --- Escape / drain detection: ball left the table (top, bottom, or sides) ---
    if (ball.pos.y > H + 30 || ball.pos.y < -30 || ball.pos.x < -30 || ball.pos.x > W + 30) {
      if (!plungerReady && gameState === STATE.LIVE) {
        loseBall();
      } else {
        // Safety net while debugging; should rarely happen.
        resetToPlunger();
      }
    }

    // --- Render ---
    Renderer.clear();
    Renderer.drawLane(LANE_LEFT, LANE_RIGHT, 40, LANE_BOTTOM);

    for (const wall of walls) Renderer.drawWall(wall);
    for (const ramp of ramps) Renderer.drawRamp(ramp, ts);
    for (const hoop of hoops) Renderer.drawHoop(hoop, ts);
    for (const bumper of bumpers) Renderer.drawBumper(bumper, ts);

    Renderer.drawParticles(particles);
    Renderer.drawBallTrail(ballTrail);
    Renderer.drawFlipper(leftFlipper, leftFlipperActive());
    Renderer.drawFlipper(rightFlipper, rightFlipperActive());
    Renderer.drawBall(ball, ts < onFireUntil);

    if (plungerReady) {
      Renderer.drawPlunger(
        PLUNGER_BALL_X,
        PLUNGER_BALL_Y + BALL_RADIUS + 4,
        plungerPower,
        plungerCharging
      );
    }

    // Hint text varies a bit by state.
    if (gameState === STATE.GAME_OVER) {
      Renderer.drawHint("Game over — press SPACE or R to play again");
    } else if (plungerReady && !plungerCharging) {
      Renderer.drawHint("Hold SPACE to charge, release to launch");
    } else if (plungerReady && plungerCharging) {
      Renderer.drawHint("Release SPACE to launch!");
    } else {
      Renderer.drawHint("Z / \u2190 = Left flipper  |  X / \u2192 = Right flipper  |  R = Restart");
    }

    Renderer.drawHUD({
      score,
      highScore,
      balls: ballsRemaining,
      state: gameState,
      combo: comboCount,
      onFire: ts < onFireUntil,
    });

    Renderer.drawScreenFlash(ts, screenFlashUntil);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
})();
