/**
 * physics.js — 2D physics primitives for the pinball engine.
 *
 * Exposes two globals:
 *   Vec    — vector math helpers (add, sub, dot, reflect, etc.)
 *   Physics — ball/wall creation and collision detection/response
 *
 * Vectors are plain {x, y} objects throughout.
 */

/* ── Vector helpers ─────────────────────────────────────────── */

const Vec = {
  add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; },
  sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; },
  scale(v, s) { return { x: v.x * s, y: v.y * s }; },
  dot(a, b) { return a.x * b.x + a.y * b.y; },
  len(v) { return Math.hypot(v.x, v.y); },

  normalize(v) {
    const l = Math.hypot(v.x, v.y);
    return l > 0.0001 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
  },

  /** Reflect velocity v across a surface with the given outward normal. */
  reflect(v, normal) {
    const d = 2 * Vec.dot(v, normal);
    return { x: v.x - d * normal.x, y: v.y - d * normal.y };
  },

  /** Rotate v by angle (radians, counter-clockwise). */
  rotate(v, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  },
};

/* ── Physics ────────────────────────────────────────────────── */

const Physics = (() => {

  /** Create a ball at (x, y) with the given radius. */
  function createBall(x, y, radius) {
    return {
      pos: { x, y },
      vel: { x: 0, y: 0 },
      radius,
    };
  }

  /** Advance ball position by one timestep, applying gravity. */
  function updateBall(ball, gravity, dt) {
    ball.vel.y += gravity * dt;
    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;
  }

  /** Create a wall (line segment) from (x1,y1) to (x2,y2). */
  function createWall(x1, y1, x2, y2) {
    return { x1, y1, x2, y2 };
  }

  /** Closest point on a line segment to an arbitrary point p. */
  function closestPointOnSegment(p, wall) {
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) return { x: wall.x1, y: wall.y1 };

    // Project p onto the segment, clamped to [0, 1]
    const t = Math.max(0, Math.min(1, ((p.x - wall.x1) * dx + (p.y - wall.y1) * dy) / lenSq));
    return { x: wall.x1 + t * dx, y: wall.y1 + t * dy };
  }

  /**
   * Detect and resolve a collision between a ball and a wall segment.
   * Uses the closest-point method: if the ball overlaps the segment,
   * push it out and reflect its velocity.
   *
   * @param {number} restitution — bounciness (0 = dead stop, 1 = perfect bounce)
   * @returns {boolean} true if a collision was resolved
   */
  function collideBallWall(ball, wall, restitution) {
    const closest = closestPointOnSegment(ball.pos, wall);
    const diff = Vec.sub(ball.pos, closest);
    const dist = Vec.len(diff);

    if (dist >= ball.radius || dist < 0.0001) return false;

    // Normal points from the wall surface toward the ball center
    const normal = Vec.normalize(diff);

    // Push ball out so it no longer overlaps
    const overlap = ball.radius - dist;
    ball.pos.x += normal.x * overlap;
    ball.pos.y += normal.y * overlap;

    // Only reflect if ball is moving toward the wall
    const velDotN = Vec.dot(ball.vel, normal);
    if (velDotN < 0) {
      ball.vel.x -= (1 + restitution) * velDotN * normal.x;
      ball.vel.y -= (1 + restitution) * velDotN * normal.y;
    }

    return true;
  }

  /**
   * Detect and resolve a collision between a ball and a circular bumper.
   *
   * @param {{x, y, radius}} bumper — bumper position and size
   * @param {number} restitution — bounciness
   * @returns {boolean} true if a collision was resolved
   */
  function collideBallCircle(ball, bumper, restitution) {
    const diff = Vec.sub(ball.pos, bumper);
    const dist = Vec.len(diff);
    const minDist = ball.radius + bumper.radius;

    if (dist >= minDist || dist < 0.0001) return false;

    const normal = Vec.normalize(diff);
    const overlap = minDist - dist;
    ball.pos.x += normal.x * overlap;
    ball.pos.y += normal.y * overlap;

    const velDotN = Vec.dot(ball.vel, normal);
    if (velDotN < 0) {
      ball.vel.x -= (1 + restitution) * velDotN * normal.x;
      ball.vel.y -= (1 + restitution) * velDotN * normal.y;
    }

    return true;
  }

  /* ── Flippers ──────────────────────────────────────────────── */

  /**
   * Create a flipper (rotating paddle).
   *
   * @param {number} px, py      — pivot (anchor) position
   * @param {number} length      — distance from pivot to tip
   * @param {number} restAngle   — angle when idle (radians, 0 = pointing right)
   * @param {number} upAngle     — angle when activated
   * @param {number} upSpeed     — how fast the flipper swings up (rad/s)
   * @param {number} downSpeed   — how fast it falls back to rest (rad/s)
   */
  function createFlipper(px, py, length, restAngle, upAngle, upSpeed = 15, downSpeed = 8) {
    return {
      pivot: { x: px, y: py },
      length,
      restAngle,
      upAngle,
      angle: restAngle,
      angularVel: 0,
      upSpeed,
      downSpeed,
    };
  }

  /** Return the current line segment {x1,y1,x2,y2} for a flipper. */
  function getFlipperSegment(flipper) {
    const tip = {
      x: flipper.pivot.x + Math.cos(flipper.angle) * flipper.length,
      y: flipper.pivot.y + Math.sin(flipper.angle) * flipper.length,
    };
    return { x1: flipper.pivot.x, y1: flipper.pivot.y, x2: tip.x, y2: tip.y };
  }

  /**
   * Rotate the flipper toward its target angle.
   * Tracks angular velocity so we can transfer energy to the ball.
   */
  function updateFlipper(flipper, active, dt) {
    const target = active ? flipper.upAngle : flipper.restAngle;
    const speed = active ? flipper.upSpeed : flipper.downSpeed;
    const prev = flipper.angle;

    const diff = target - flipper.angle;
    if (Math.abs(diff) < speed * dt) {
      flipper.angle = target;
    } else {
      flipper.angle += Math.sign(diff) * speed * dt;
    }

    flipper.angularVel = dt > 0 ? (flipper.angle - prev) / dt : 0;
  }

  /**
   * Collide the ball with a flipper.
   * First resolves the wall-like collision, then adds velocity
   * from the flipper's rotation at the contact point.
   */
  function collideBallFlipper(ball, flipper, restitution) {
    const seg = getFlipperSegment(flipper);
    if (!collideBallWall(ball, seg, restitution)) return false;

    // Transfer rotational energy: the flipper surface moves fastest at the tip.
    // Tangential speed at the contact = angularVel * distance from pivot.
    const closest = closestPointOnSegment(ball.pos, seg);
    const arm = Vec.sub(closest, flipper.pivot);
    const armLen = Vec.len(arm);

    if (armLen > 0.1 && Math.abs(flipper.angularVel) > 0.1) {
      const tangent = Vec.normalize({ x: -arm.y, y: arm.x });
      const extraSpeed = flipper.angularVel * armLen * 0.4;
      ball.vel.x += tangent.x * extraSpeed;
      ball.vel.y += tangent.y * extraSpeed;
    }

    return true;
  }

  return {
    createBall,
    updateBall,
    createWall,
    closestPointOnSegment,
    collideBallWall,
    collideBallCircle,
    createFlipper,
    getFlipperSegment,
    updateFlipper,
    collideBallFlipper,
  };
})();
