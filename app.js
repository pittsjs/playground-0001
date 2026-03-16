(() => {
  "use strict";

  // ── Canvas ──
  const canvas = document.getElementById("court");
  const ctx = canvas.getContext("2d");
  const W = 800;
  const H = 540;

  function resize() {
    const ratio = W / H;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  canvas.width = W;
  canvas.height = H;
  window.addEventListener("resize", resize);
  resize();

  // ── Constants ──
  const COURT = { left: 50, right: 750, top: 30, bottom: 510, cx: 400 };
  const BASKET = { x: 400, y: 82 };
  const THREE_PT_R = 200;
  const KEY_W = 160;
  const KEY_H = 190;

  const P_RADIUS = 16;
  const BALL_R = 7;
  const P_SPEED = 220;
  const AI_SPEED = 185;
  const SPRINT_MUL = 1.35;
  const STEAL_RANGE = 34;
  const STEAL_RATE = 1.4;
  const WIN_SCORE = 21;
  const POWER_RATE = 2.0;
  const SWEET_LO = 0.35;
  const SWEET_HI = 0.65;

  const C = {
    courtFloor: "#1b1428",
    courtAccent: "#231a38",
    courtLine: "rgba(120, 160, 255, 0.25)",
    paint: "rgba(78, 140, 255, 0.07)",
    home: "#4e8cff",
    homeLight: "#7aabff",
    away: "#ff5d7a",
    awayLight: "#ff8fa3",
    ball: "#ff8c00",
    rim: "#ff6b35",
    backboard: "#aaa",
    net: "rgba(255,255,255,0.35)",
    shadow: "rgba(0,0,0,0.35)",
    text: "#e6ecff",
    muted: "#8898c0",
    green: "#4caf50",
    yellow: "#ffd166",
    red: "#ff5d7a",
  };

  // ── State ──
  const ST = {
    TITLE: 0,
    COUNTDOWN: 1,
    LIVE: 2,
    BALL_AIR: 3,
    SCORED: 4,
    REBOUND: 5,
    INBOUND: 6,
    GAME_OVER: 7,
  };

  let gs = ST.TITLE;
  let stTimer = 0;
  let cdNum = 3;
  let gameTime = 0;
  let score = { home: 0, away: 0 };
  let poss = "home";
  let lastScorer = null;
  let scoreFlash = 0;

  let player = makeEntity(W / 2, H - 120, "home");
  let ai = makeEntity(W / 2, 250, "away");
  let ball = makeBall();
  let shotPower = 0;
  let charging = false;

  let msgs = [];
  let particles = [];
  let keys = {};

  function makeEntity(x, y, team) {
    return {
      x, y, vx: 0, vy: 0,
      radius: P_RADIUS, team,
      hasBall: team === "home",
      targetX: x, targetY: y,
      shootTimer: 0, decisionTimer: 0,
    };
  }

  function makeBall() {
    return {
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0,
      state: "held", holder: "home",
      trail: [],
      from: { x: 0, y: 0 },
      willScore: false, pts: 2,
      flightT: 0, flightDur: 0.7,
    };
  }

  // ── Input ──
  document.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (e.code === "Enter" || e.code === "Space") e.preventDefault();

    if (e.code === "Enter") {
      if (gs === ST.TITLE) startGame();
      else if (gs === ST.GAME_OVER) resetAll();
    }
    if (e.code === "Space" && gs === ST.LIVE && poss === "home" && player.hasBall) {
      charging = true;
      shotPower = 0;
    }
  });

  document.addEventListener("keyup", (e) => {
    keys[e.code] = false;
    if (e.code === "Space" && charging) releaseShot();
  });

  // ── Utilities ──
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function dBasket(e) { return dist(e, BASKET); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rng(lo, hi) { return lo + Math.random() * (hi - lo); }

  function addMsg(text, x, y, color, size = 22, dur = 1.4) {
    msgs.push({ text, x, y, life: dur, max: dur, color, size, vy: -35 });
  }
  function burst(x, y, n, color, spd = 120) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * spd;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.5, max: 0.9,
        color, size: 2 + Math.random() * 3,
      });
    }
  }

  // ── Game management ──
  function startGame() {
    score = { home: 0, away: 0 };
    poss = "home";
    resetPositions("home");
    gs = ST.COUNTDOWN;
    cdNum = 3;
    stTimer = 0;
    msgs = [];
    particles = [];
  }

  function resetAll() {
    gs = ST.TITLE;
    score = { home: 0, away: 0 };
    resetPositions("home");
  }

  function resetPositions(team) {
    if (team === "home") {
      player.x = W / 2; player.y = H - 120;
      player.hasBall = true;
      ai.x = W / 2; ai.y = 250;
      ai.hasBall = false;
    } else {
      ai.x = W / 2; ai.y = H - 120;
      ai.hasBall = true;
      player.x = W / 2; player.y = 250;
      player.hasBall = false;
    }
    ball.state = "held";
    ball.holder = team;
    ball.z = 0;
    ball.trail = [];
    poss = team;
    charging = false;
    shotPower = 0;
    ai.shootTimer = 0;
    ai.decisionTimer = 0;
  }

  // ── Shooting ──
  function calcAccuracy(shooter, defender) {
    const d = dBasket(shooter);
    let base;
    if (d < 70) base = 0.82;
    else if (d < 140) base = 0.60;
    else if (d < THREE_PT_R) base = 0.46;
    else if (d < 270) base = 0.34;
    else base = 0.14;
    const dd = dist(shooter, defender);
    const defMod = dd < 40 ? 0.45 : dd < 80 ? 0.7 : 1.0;
    return base * defMod;
  }

  function releaseShot() {
    if (!charging || gs !== ST.LIVE) { charging = false; return; }
    charging = false;

    const acc = calcAccuracy(player, ai);
    const pDist = Math.abs(shotPower - 0.5) / 0.5;
    const pMod = 1 - pDist * 0.55;
    const finalAcc = acc * pMod;
    const willScore = Math.random() < finalAcc;
    const pts = dist(player, BASKET) >= THREE_PT_R ? 3 : 2;

    launchBall(player, willScore, pts, "home");
  }

  function aiShoot() {
    const acc = calcAccuracy(ai, player);
    const pMod = rng(0.7, 1.0);
    const finalAcc = acc * pMod;
    const willScore = Math.random() < finalAcc;
    const pts = dist(ai, BASKET) >= THREE_PT_R ? 3 : 2;

    launchBall(ai, willScore, pts, "away");
  }

  function launchBall(shooter, willScore, pts, team) {
    const d = dBasket(shooter);
    ball.state = "in_air";
    ball.from = { x: shooter.x, y: shooter.y };
    ball.willScore = willScore;
    ball.pts = pts;
    ball.holder = team;
    ball.x = shooter.x;
    ball.y = shooter.y;
    ball.z = 0;
    ball.flightT = 0;
    ball.flightDur = 0.55 + d / 550;
    ball.trail = [];
    shooter.hasBall = false;
    gs = ST.BALL_AIR;
    shotPower = 0;
  }

  // ── Update ──
  let lastTs = 0;

  function update(dt) {
    dt = Math.min(dt, 0.05);
    gameTime += dt;

    msgs = msgs.filter((m) => { m.life -= dt; m.y += m.vy * dt; return m.life > 0; });
    particles = particles.filter((p) => {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.life > 0;
    });
    if (scoreFlash > 0) scoreFlash -= dt;

    switch (gs) {
      case ST.TITLE: break;
      case ST.COUNTDOWN:
        stTimer += dt;
        if (stTimer >= 1) { stTimer -= 1; cdNum--; if (cdNum <= 0) gs = ST.LIVE; }
        break;
      case ST.LIVE:
        updatePlayer(dt);
        updateAI(dt);
        updateHeld();
        checkSteals(dt);
        if (charging) {
          shotPower = Math.min(1, shotPower + POWER_RATE * dt);
          if (shotPower >= 1) releaseShot();
        }
        break;
      case ST.BALL_AIR:
        updateFlight(dt);
        break;
      case ST.SCORED:
        stTimer += dt;
        if (stTimer >= 1.8) {
          if (score.home >= WIN_SCORE || score.away >= WIN_SCORE) {
            gs = ST.GAME_OVER;
          } else {
            const next = lastScorer === "home" ? "away" : "home";
            resetPositions(next);
            gs = ST.INBOUND;
            stTimer = 0;
          }
        }
        break;
      case ST.INBOUND:
        stTimer += dt;
        if (stTimer >= 0.8) gs = ST.LIVE;
        break;
      case ST.REBOUND:
        updateLoose(dt);
        updatePlayer(dt);
        updateAIRebound(dt);
        checkPickup();
        break;
      case ST.GAME_OVER: break;
    }
  }

  function updatePlayer(dt) {
    let dx = 0, dy = 0;
    if (keys["ArrowLeft"] || keys["KeyA"]) dx -= 1;
    if (keys["ArrowRight"] || keys["KeyD"]) dx += 1;
    if (keys["ArrowUp"] || keys["KeyW"]) dy -= 1;
    if (keys["ArrowDown"] || keys["KeyS"]) dy += 1;
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx /= len; dy /= len; }

    const sprint = (keys["ShiftLeft"] || keys["ShiftRight"]) ? SPRINT_MUL : 1;
    const spd = P_SPEED * sprint;
    player.x += dx * spd * dt;
    player.y += dy * spd * dt;

    player.x = clamp(player.x, COURT.left + P_RADIUS, COURT.right - P_RADIUS);
    player.y = clamp(player.y, COURT.top + P_RADIUS, COURT.bottom - P_RADIUS);
    pushApart(player, ai);
  }

  function pushApart(a, b) {
    const d = dist(a, b);
    if (d < P_RADIUS * 2 && d > 0.1) {
      const overlap = P_RADIUS * 2 - d;
      const nx = (a.x - b.x) / d;
      const ny = (a.y - b.y) / d;
      a.x += nx * overlap * 0.5;
      a.y += ny * overlap * 0.5;
      b.x -= nx * overlap * 0.5;
      b.y -= ny * overlap * 0.5;
    }
  }

  function updateAI(dt) {
    ai.decisionTimer -= dt;
    if (poss === "away" && ai.hasBall) {
      ai.shootTimer += dt;
      if (ai.decisionTimer <= 0) {
        ai.decisionTimer = 0.3 + Math.random() * 0.5;
        const pd = dist(player, ai);
        if (pd < 55) {
          const ang = Math.atan2(BASKET.y - ai.y, BASKET.x - ai.x);
          const side = Math.random() < 0.5 ? 1 : -1;
          ai.targetX = ai.x + Math.cos(ang + side * 1.1) * 90;
          ai.targetY = ai.y + Math.sin(ang + side * 1.1) * 90;
        } else {
          ai.targetX = BASKET.x + rng(-80, 80);
          ai.targetY = BASKET.y + 70 + rng(0, 110);
        }
      }
      const tx = ai.targetX - ai.x, ty = ai.targetY - ai.y;
      const td = Math.hypot(tx, ty);
      if (td > 4) { ai.x += (tx / td) * AI_SPEED * dt; ai.y += (ty / td) * AI_SPEED * dt; }

      const shootDist = dBasket(ai);
      const defDist = dist(player, ai);
      if (ai.shootTimer > 1.5 && shootDist < 260 && (defDist > 55 || shootDist < 90 || ai.shootTimer > 4.5)) {
        aiShoot();
      }
    } else if (poss === "home") {
      const ix = lerp(player.x, BASKET.x, 0.35);
      const iy = lerp(player.y, BASKET.y, 0.4);
      const tx = ix - ai.x, ty = iy - ai.y;
      const td = Math.hypot(tx, ty);
      const spd = AI_SPEED * (player.hasBall && dist(player, ai) < 140 ? 1.1 : 0.85);
      if (td > 4) { ai.x += (tx / td) * spd * dt; ai.y += (ty / td) * spd * dt; }
    }
    ai.x = clamp(ai.x, COURT.left + P_RADIUS, COURT.right - P_RADIUS);
    ai.y = clamp(ai.y, COURT.top + P_RADIUS, COURT.bottom - P_RADIUS);
  }

  function updateAIRebound(dt) {
    const tx = ball.x - ai.x, ty = ball.y - ai.y;
    const td = Math.hypot(tx, ty);
    if (td > 4) { ai.x += (tx / td) * AI_SPEED * dt; ai.y += (ty / td) * AI_SPEED * dt; }
    ai.x = clamp(ai.x, COURT.left + P_RADIUS, COURT.right - P_RADIUS);
    ai.y = clamp(ai.y, COURT.top + P_RADIUS, COURT.bottom - P_RADIUS);
  }

  function updateHeld() {
    if (ball.state !== "held") return;
    const h = ball.holder === "home" ? player : ai;
    ball.x = h.x;
    ball.y = h.y;
  }

  function checkSteals(dt) {
    if (ball.state !== "held") return;
    if (poss === "home" && player.hasBall) {
      if (dist(player, ai) < STEAL_RANGE && Math.random() < STEAL_RATE * dt) {
        player.hasBall = false; ai.hasBall = true;
        poss = "away"; ball.holder = "away";
        addMsg("STEAL!", ai.x, ai.y - 30, C.away, 20);
        ai.shootTimer = 0;
      }
    } else if (poss === "away" && ai.hasBall) {
      if (dist(player, ai) < STEAL_RANGE && Math.random() < STEAL_RATE * 0.65 * dt) {
        ai.hasBall = false; player.hasBall = true;
        poss = "home"; ball.holder = "home";
        addMsg("STEAL!", player.x, player.y - 30, C.home, 20);
      }
    }
  }

  function updateFlight(dt) {
    ball.flightT += dt;
    const t = clamp(ball.flightT / ball.flightDur, 0, 1);
    ball.trail.push({ x: ball.x, y: ball.y, life: 0.25 });
    ball.trail = ball.trail.filter((p) => { p.life -= dt; return p.life > 0; });

    if (t >= 1) {
      if (ball.willScore) {
        const team = ball.holder;
        score[team] += ball.pts;
        lastScorer = team;
        scoreFlash = 0.4;
        const label = ball.pts === 3 ? "THREE!" : "SCORE!";
        addMsg(label, BASKET.x, BASKET.y + 25, team === "home" ? C.home : C.away, 30, 1.8);
        burst(BASKET.x, BASKET.y, 18, team === "home" ? C.homeLight : C.awayLight, 140);
        ball.x = BASKET.x; ball.y = BASKET.y; ball.z = 0; ball.state = "held";
        gs = ST.SCORED; stTimer = 0;
      } else {
        const ang = rng(0, Math.PI * 2);
        const bd = rng(35, 65);
        ball.x = BASKET.x + Math.cos(ang) * bd;
        ball.y = BASKET.y + Math.abs(Math.sin(ang)) * bd + 25;
        ball.vx = Math.cos(ang) * 70;
        ball.vy = Math.abs(Math.sin(ang)) * 70 + 30;
        ball.z = 0; ball.state = "loose";
        gs = ST.REBOUND;
        addMsg("MISS", BASKET.x, BASKET.y + 25, C.muted, 18);
      }
  } else {
      ball.x = lerp(ball.from.x, BASKET.x, t);
      ball.y = lerp(ball.from.y, BASKET.y, t);
      ball.z = Math.sin(t * Math.PI) * 80;
    }
  }

  function updateLoose(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vx *= 0.96;
    ball.vy *= 0.96;
    if (ball.x < COURT.left) { ball.x = COURT.left; ball.vx *= -0.4; }
    if (ball.x > COURT.right) { ball.x = COURT.right; ball.vx *= -0.4; }
    if (ball.y < COURT.top) { ball.y = COURT.top; ball.vy *= -0.4; }
    if (ball.y > COURT.bottom) { ball.y = COURT.bottom; ball.vy *= -0.4; }
  }

  function checkPickup() {
    const pd = dist(player, ball), ad = dist(ai, ball);
    const reach = P_RADIUS + BALL_R + 4;
    if (pd < reach) {
      player.hasBall = true; ai.hasBall = false;
      poss = "home"; ball.state = "held"; ball.holder = "home";
      gs = ST.LIVE;
      addMsg("REBOUND!", player.x, player.y - 28, C.home, 17);
    } else if (ad < reach) {
      ai.hasBall = true; player.hasBall = false;
      poss = "away"; ball.state = "held"; ball.holder = "away";
      gs = ST.LIVE; ai.shootTimer = 0;
      addMsg("REBOUND!", ai.x, ai.y - 28, C.away, 17);
    }
  }

  // ── Drawing ──
  function draw(ts) {
    ctx.clearRect(0, 0, W, H);

    switch (gs) {
      case ST.TITLE:
        drawCourt();
        drawTitle(ts);
        break;
      case ST.GAME_OVER:
        drawCourt();
        drawEntities(ts);
        drawHUD();
        drawGameOver();
        break;
      default:
        drawCourt();
        drawEntities(ts);
        drawHUD();
        if (gs === ST.COUNTDOWN) drawCountdown();
        if (gs === ST.INBOUND) drawInbound();
        if (gs === ST.SCORED && scoreFlash > 0) drawFlash();
        break;
    }
    drawMsgs();
    drawParticles();
  }

  function drawCourt() {
    const grd = ctx.createRadialGradient(W / 2, H / 3, 60, W / 2, H / 3, 450);
    grd.addColorStop(0, C.courtAccent);
    grd.addColorStop(1, C.courtFloor);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = C.courtLine;
    ctx.lineWidth = 2;
    ctx.strokeRect(COURT.left, COURT.top, COURT.right - COURT.left, COURT.bottom - COURT.top);

    const kl = COURT.cx - KEY_W / 2;
    ctx.fillStyle = C.paint;
    ctx.fillRect(kl, COURT.top, KEY_W, KEY_H);
    ctx.strokeRect(kl, COURT.top, KEY_W, KEY_H);

    ctx.beginPath();
    ctx.arc(COURT.cx, COURT.top + KEY_H, KEY_W / 2, 0, Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(BASKET.x, BASKET.y, THREE_PT_R, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();

    const cornerInset = 40;
    const arcStartX = BASKET.x - Math.cos(0.18 * Math.PI) * THREE_PT_R;
    const arcEndX = BASKET.x + Math.cos(0.18 * Math.PI) * THREE_PT_R;
    ctx.beginPath();
    ctx.moveTo(COURT.left + cornerInset, COURT.top);
    ctx.lineTo(COURT.left + cornerInset, BASKET.y + Math.sin(0.82 * Math.PI) * THREE_PT_R);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(COURT.right - cornerInset, COURT.top);
    ctx.lineTo(COURT.right - cornerInset, BASKET.y + Math.sin(0.18 * Math.PI) * THREE_PT_R);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(COURT.left, COURT.bottom);
    ctx.lineTo(COURT.right, COURT.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(COURT.cx, COURT.bottom, 55, Math.PI, 0);
    ctx.stroke();

    drawBasket();
  }

  function drawBasket() {
    ctx.fillStyle = C.backboard;
    ctx.fillRect(BASKET.x - 24, BASKET.y - 12, 48, 4);

    ctx.beginPath();
    ctx.arc(BASKET.x, BASKET.y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = C.rim;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = C.net;
    ctx.lineWidth = 1;
    for (let i = -7; i <= 7; i += 3.5) {
      ctx.beginPath();
      ctx.moveTo(BASKET.x + i, BASKET.y + 6);
      ctx.lineTo(BASKET.x + i * 0.4, BASKET.y + 18);
      ctx.stroke();
    }
  }

  function drawEntities(ts) {
    drawShadow(player.x, player.y + 4, P_RADIUS);
    drawShadow(ai.x, ai.y + 4, P_RADIUS);

    ball.trail.forEach((t) => {
      const a = t.life / 0.25;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * a, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,140,0,${a * 0.25})`;
      ctx.fill();
    });

    if (ball.state === "loose") drawBall(ball.x, ball.y, 0);

    drawPlayer(ai, C.away, C.awayLight, "CPU");
    drawPlayer(player, C.home, C.homeLight, "YOU");

    if (ball.state === "held") {
      const h = ball.holder === "home" ? player : ai;
      const bob = Math.sin(ts * 0.008) * 3;
      drawBall(h.x + 11, h.y - 4 + bob, 0);
    }

    if (ball.state === "in_air") {
      const ss = Math.max(0.3, 1 - ball.z / 120);
      drawShadow(ball.x, ball.y + 3, BALL_R * ss);
      drawBall(ball.x, ball.y - ball.z * 0.3, ball.z);
    }

    if (charging) drawPowerBar(player.x, player.y - 34);
  }

  function drawShadow(x, y, r) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.shadow;
    ctx.fill();
  }

  function drawPlayer(p, col, light, label) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(p.x - 3, p.y - 3, 2, p.x, p.y, p.radius);
    g.addColorStop(0, light);
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, p.x, p.y);
  }

  function drawBall(x, y, z) {
    const s = 1 + z / 220;
    const r = BALL_R * s;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
    g.addColorStop(0, "#ffaa33");
    g.addColorStop(1, "#cc6600");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#8B4513";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.strokeStyle = "rgba(139,69,19,0.4)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function drawPowerBar(x, y) {
    const bw = 48, bh = 7;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(x - bw / 2 - 2, y - 2, bw + 4, bh + 4, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(76,175,80,0.22)";
    ctx.fillRect(x - bw / 2 + bw * SWEET_LO, y, bw * (SWEET_HI - SWEET_LO), bh);

    const inSweet = shotPower >= SWEET_LO && shotPower <= SWEET_HI;
    ctx.fillStyle = inSweet ? C.green : shotPower < SWEET_LO ? C.yellow : C.red;
    ctx.fillRect(x - bw / 2, y, bw * shotPower, bh);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - bw / 2, y, bw, bh);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawHUD() {
    ctx.textBaseline = "top";
    ctx.textAlign = "center";

    const pulse = scoreFlash > 0 ? 1 + scoreFlash * 0.4 : 1;
    ctx.font = `bold ${Math.round(26 * pulse)}px sans-serif`;
    ctx.fillStyle = C.text;
    ctx.fillText(`${score.home}  -  ${score.away}`, W / 2, 5);

    ctx.font = "11px sans-serif";
    ctx.fillStyle = C.muted;
    ctx.fillText(`First to ${WIN_SCORE}`, W / 2, 34);

    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = C.home;
    ctx.fillText("YOU", W / 2 - 34, 8);
    ctx.textAlign = "left";
    ctx.fillStyle = C.away;
    ctx.fillText("CPU", W / 2 + 34, 8);

    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = C.muted;
    const arrow = poss === "home" ? "\u25C0 Ball" : "Ball \u25B6";
    ctx.fillText(arrow, W / 2, 48);

    ctx.fillStyle = "rgba(255,255,255,0.13)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("Arrows: Move  |  Space: Shoot  |  Shift: Sprint", 12, H - 6);
  }

  function drawTitle(ts) {
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = C.text;
    ctx.font = "bold 52px sans-serif";
    ctx.fillText("BASKETBALL", W / 2, H / 2 - 65);

    ctx.font = "20px sans-serif";
    ctx.fillStyle = C.muted;
    ctx.fillText("1 v 1  Half Court", W / 2, H / 2 - 18);

    const blink = Math.sin(ts * 0.004) * 0.3 + 0.7;
    ctx.globalAlpha = blink;
    ctx.font = "17px sans-serif";
    ctx.fillStyle = C.ball;
    ctx.fillText("Press ENTER to play", W / 2, H / 2 + 35);
    ctx.globalAlpha = 1;

    ctx.font = "13px sans-serif";
    ctx.fillStyle = C.muted;
    ctx.fillText("Arrow Keys: Move  |  Hold Space: Shoot  |  Shift: Sprint", W / 2, H / 2 + 75);
    ctx.fillText(`First to ${WIN_SCORE} wins`, W / 2, H / 2 + 100);
  }

  function drawCountdown() {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.text;
    ctx.font = "bold 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cdNum > 0 ? String(cdNum) : "GO!", W / 2, H / 2);
  }

  function drawInbound() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 22px sans-serif";
    ctx.fillStyle = poss === "home" ? C.home : C.away;
    ctx.fillText(poss === "home" ? "YOUR BALL" : "CPU BALL", W / 2, H / 2);
  }

  function drawFlash() {
    ctx.globalAlpha = scoreFlash * 0.2;
    ctx.fillStyle = lastScorer === "home" ? C.home : C.away;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  function drawGameOver() {
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, W, H);

    const winner = score.home >= WIN_SCORE ? "home" : "away";
    const label = winner === "home" ? "YOU WIN!" : "CPU WINS";
    ctx.fillStyle = winner === "home" ? C.home : C.away;
    ctx.font = "bold 52px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W / 2, H / 2 - 45);

    ctx.fillStyle = C.text;
    ctx.font = "bold 30px sans-serif";
    ctx.fillText(`${score.home} - ${score.away}`, W / 2, H / 2 + 10);

    ctx.fillStyle = C.muted;
    ctx.font = "16px sans-serif";
    ctx.fillText("Press ENTER to play again", W / 2, H / 2 + 55);
  }

  function drawMsgs() {
    msgs.forEach((m) => {
      ctx.globalAlpha = clamp(m.life / m.max, 0, 1);
      ctx.fillStyle = m.color;
      ctx.font = `bold ${m.size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.text, m.x, m.y);
    });
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    particles.forEach((p) => {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ── Loop ──
  function loop(ts) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    update(dt);
    draw(ts);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame((ts) => { lastTs = ts; loop(ts); });
})();
