const APP_VERSION = "0.2.0";
const STORAGE_KEY = "basketball-scoreboard-state-v1";
const DEFAULT_GAME_SECONDS = 10 * 60;
const DEFAULT_SHOT_SECONDS = 24;

function createInitialState() {
  return {
    gameSeconds: DEFAULT_GAME_SECONDS,
    shotSeconds: DEFAULT_SHOT_SECONDS,
    period: 1,
    running: false,
    possession: "home",
    teams: {
      home: { name: "Home", score: 0, fouls: 0, timeouts: 0 },
      away: { name: "Away", score: 0, fouls: 0, timeouts: 0 },
    },
  };
}

const state = loadState();

const el = {
  appVersion: document.getElementById("app-version"),
  gameClock: document.getElementById("game-clock"),
  shotClock: document.getElementById("shot-clock"),
  periodDisplay: document.getElementById("period-display"),
  startStopBtn: document.getElementById("start-stop-btn"),
  resetGameClockBtn: document.getElementById("reset-game-clock-btn"),
  resetShotClockBtn: document.getElementById("reset-shot-clock-btn"),
  set14Btn: document.getElementById("set-14-btn"),
  prevPeriodBtn: document.getElementById("prev-period-btn"),
  nextPeriodBtn: document.getElementById("next-period-btn"),
  homePossessionBtn: document.getElementById("home-possession-btn"),
  awayPossessionBtn: document.getElementById("away-possession-btn"),
  newGameBtn: document.getElementById("new-game-btn"),
  exportBtn: document.getElementById("export-btn"),
  homeName: document.getElementById("home-name"),
  awayName: document.getElementById("away-name"),
  homeScore: document.getElementById("home-score"),
  awayScore: document.getElementById("away-score"),
  homeFouls: document.getElementById("home-fouls"),
  awayFouls: document.getElementById("away-fouls"),
  homeTimeouts: document.getElementById("home-timeouts"),
  awayTimeouts: document.getElementById("away-timeouts"),
};

function formatGameClock(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createInitialState();
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      ...createInitialState(),
      ...parsed,
      teams: {
        home: { ...createInitialState().teams.home, ...(parsed.teams?.home ?? {}) },
        away: { ...createInitialState().teams.away, ...(parsed.teams?.away ?? {}) },
      },
    };
  } catch {
    return createInitialState();
  }
}

function render() {
  el.appVersion.textContent = APP_VERSION;
  el.gameClock.textContent = formatGameClock(state.gameSeconds);
  el.shotClock.textContent = String(Math.max(0, state.shotSeconds));
  el.periodDisplay.textContent = String(state.period);
  el.startStopBtn.textContent = state.running ? "Pause" : "Start";
  el.homeName.value = state.teams.home.name;
  el.awayName.value = state.teams.away.name;
  el.homeScore.textContent = String(state.teams.home.score);
  el.awayScore.textContent = String(state.teams.away.score);
  el.homeFouls.textContent = String(state.teams.home.fouls);
  el.awayFouls.textContent = String(state.teams.away.fouls);
  el.homeTimeouts.textContent = String(state.teams.home.timeouts);
  el.awayTimeouts.textContent = String(state.teams.away.timeouts);
  el.homePossessionBtn.classList.toggle("active", state.possession === "home");
  el.awayPossessionBtn.classList.toggle("active", state.possession === "away");
  saveState();
}

function resetGameClock() {
  state.gameSeconds = DEFAULT_GAME_SECONDS;
}

function resetShotClock(seconds = DEFAULT_SHOT_SECONDS) {
  state.shotSeconds = seconds;
}

function newGame() {
  const nextState = createInitialState();
  nextState.teams.home.name = state.teams.home.name;
  nextState.teams.away.name = state.teams.away.name;
  Object.assign(state, nextState);
  render();
}

function tick() {
  if (!state.running) {
    return;
  }

  if (state.gameSeconds > 0) {
    state.gameSeconds -= 1;
  } else {
    state.running = false;
  }

  if (state.shotSeconds > 0) {
    state.shotSeconds -= 1;
  } else {
    resetShotClock();
  }

  render();
}

function exportState() {
  const snapshot = { version: APP_VERSION, exportedAt: new Date().toISOString(), game: state };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `basketball-game-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

el.startStopBtn.addEventListener("click", () => {
  if (state.gameSeconds <= 0) {
    return;
  }
  state.running = !state.running;
  render();
});

el.resetGameClockBtn.addEventListener("click", () => {
  state.running = false;
  resetGameClock();
  render();
});

el.resetShotClockBtn.addEventListener("click", () => {
  resetShotClock();
  render();
});

el.set14Btn.addEventListener("click", () => {
  resetShotClock(14);
  render();
});

el.prevPeriodBtn.addEventListener("click", () => {
  state.period = Math.max(1, state.period - 1);
  render();
});

el.nextPeriodBtn.addEventListener("click", () => {
  state.period = Math.min(10, state.period + 1);
  render();
});

el.homePossessionBtn.addEventListener("click", () => {
  state.possession = "home";
  render();
});

el.awayPossessionBtn.addEventListener("click", () => {
  state.possession = "away";
  render();
});

el.homeName.addEventListener("input", () => {
  state.teams.home.name = el.homeName.value.trim() || "Home";
  render();
});

el.awayName.addEventListener("input", () => {
  state.teams.away.name = el.awayName.value.trim() || "Away";
  render();
});

document.querySelectorAll(".score-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const { team, points } = button.dataset;
    if (!team || !points) {
      return;
    }
    state.teams[team].score += Number(points);
    render();
  });
});

document.querySelectorAll(".foul-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const { team, change } = button.dataset;
    if (!team || !change) {
      return;
    }
    state.teams[team].fouls = Math.max(0, state.teams[team].fouls + Number(change));
    render();
  });
});

document.querySelectorAll(".timeout-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const { team, change } = button.dataset;
    if (!team || !change) {
      return;
    }
    state.teams[team].timeouts = Math.max(0, state.teams[team].timeouts + Number(change));
    render();
  });
});

document.querySelectorAll(".reset-team-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const { team } = button.dataset;
    if (!team) {
      return;
    }
    state.teams[team].score = 0;
    state.teams[team].fouls = 0;
    state.teams[team].timeouts = 0;
    render();
  });
});

el.newGameBtn.addEventListener("click", newGame);
el.exportBtn.addEventListener("click", exportState);

setInterval(tick, 1000);
render();
