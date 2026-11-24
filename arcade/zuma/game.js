(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const boardFrame = document.getElementById("board-frame");
  const overlay = document.getElementById("overlay");
  const startBtn = document.getElementById("start-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const restartBtn = document.getElementById("restart-btn");
  const fsBtn = document.getElementById("fs-btn");
  const landscapeTip = document.getElementById("landscape-tip");
  const landscapeBtn = document.getElementById("landscape-btn");
  const actionBar = document.getElementById("action-bar");
  const levelEl = document.getElementById("level");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const remainingEl = document.getElementById("remaining");
  const stateEl = document.getElementById("state");

  if (
    !canvas ||
    !ctx ||
    !boardFrame ||
    !overlay ||
    !startBtn ||
    !pauseBtn ||
    !restartBtn ||
    !fsBtn ||
    !landscapeTip ||
    !landscapeBtn ||
    !actionBar ||
    !levelEl ||
    !scoreEl ||
    !bestEl ||
    !remainingEl ||
    !stateEl
  ) {
    return;
  }

  const BEST_KEY = "cartofia_zuma_best_v1";
  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;

  const SHOOTER_X = WIDTH * 0.5;
  const SHOOTER_Y = HEIGHT * 0.72;
  const SHOOTER_RADIUS = 28;
  const BALL_RADIUS = 12;
  const BALL_SPACING = BALL_RADIUS * 2.02;
  const END_MARGIN = BALL_RADIUS * 1.25;
  const SPAWN_HOLE_OFFSET = 0;

  const PALETTE = ["#ff5d8b", "#57c2ff", "#ffd057", "#86f6a4", "#c58bff", "#ff9f5a"];
  const LEVELS = [
    { name: "Temple Entry", marbles: 34, speed: 44, colorCount: 3, spawnInterval: 0.80, compress: 150, shotSpeed: 640, path: 0 },
    { name: "Stone Gallery", marbles: 38, speed: 48, colorCount: 3, spawnInterval: 0.76, compress: 156, shotSpeed: 650, path: 1 },
    { name: "Jaguar Gate", marbles: 42, speed: 52, colorCount: 4, spawnInterval: 0.72, compress: 162, shotSpeed: 660, path: 2 },
    { name: "Sunway", marbles: 46, speed: 56, colorCount: 4, spawnInterval: 0.68, compress: 168, shotSpeed: 670, path: 0 },
    { name: "Moon Terrace", marbles: 50, speed: 60, colorCount: 4, spawnInterval: 0.64, compress: 174, shotSpeed: 680, path: 1 },
    { name: "Emerald Hall", marbles: 54, speed: 64, colorCount: 5, spawnInterval: 0.60, compress: 180, shotSpeed: 690, path: 2 },
    { name: "Obsidian Span", marbles: 58, speed: 68, colorCount: 5, spawnInterval: 0.57, compress: 188, shotSpeed: 700, path: 0 },
    { name: "Oracle Route", marbles: 62, speed: 72, colorCount: 5, spawnInterval: 0.54, compress: 196, shotSpeed: 710, path: 1 },
    { name: "Temple Core", marbles: 66, speed: 76, colorCount: 6, spawnInterval: 0.51, compress: 204, shotSpeed: 720, path: 2 },
    { name: "Solar Vault", marbles: 70, speed: 80, colorCount: 6, spawnInterval: 0.49, compress: 212, shotSpeed: 735, path: 0 },
    { name: "Celestial Rift", marbles: 74, speed: 84, colorCount: 6, spawnInterval: 0.47, compress: 220, shotSpeed: 750, path: 1 },
    { name: "Apex Idol", marbles: 80, speed: 90, colorCount: 6, spawnInterval: 0.44, compress: 230, shotSpeed: 770, path: 2 }
  ];

  let levelIndex = 0;
  let score = 0;
  let best = loadBest();
  let gameState = "ready"; // ready, running, paused, lost, cleared, complete
  let gameStartTime = null;
  let runStartTime = null; // whole run (retries keep the score), for plausibility checks

  let path = compilePath(getPathPoints(LEVELS[levelIndex].path));
  let chain = [];
  let shots = [];
  let spawned = 0;
  let spawnTimer = 0;
  let shotId = 0;

  let currentColor = null;
  let nextColor = null;
  let aimAngle = -Math.PI / 2;
  let lastFrameTime = performance.now();

  const isCoarsePointer = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  function loadBest() {
    const raw = Number(window.localStorage.getItem(BEST_KEY) || 0);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
    return 0;
  }

  function saveBest() {
    try {
      window.localStorage.setItem(BEST_KEY, String(best));
    } catch (_error) {
      // ignore storage failures
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function colorWithAlpha(color, alpha) {
    const a = clamp(alpha, 0, 1);
    if (typeof color === "string" && color.charAt(0) === "#") {
      const hex = color.slice(1);
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return "rgba(" + String(r) + ", " + String(g) + ", " + String(b) + ", " + String(a) + ")";
      }
    }
    if (typeof color === "string" && color.startsWith("rgb(")) {
      return color.replace("rgb(", "rgba(").replace(")", ", " + String(a) + ")");
    }
    if (typeof color === "string" && color.startsWith("rgba(")) {
      return color.replace(/rgba\(([^)]+),\s*[^,]+\)$/, "rgba($1, " + String(a) + ")");
    }
    return "rgba(174, 219, 255, " + String(a) + ")";
  }

  function currentLevel() {
    return LEVELS[levelIndex];
  }

  function setOverlay(text, show) {
    overlay.textContent = text;
    overlay.classList.toggle("hidden", !show);
  }

  function stateText() {
    if (gameState === "running") {
      return "Live";
    }
    if (gameState === "paused") {
      return "Paused";
    }
    if (gameState === "lost") {
      return "Defeat";
    }
    if (gameState === "cleared") {
      return "Level Clear";
    }
    if (gameState === "complete") {
      return "Run Complete";
    }
    return "Ready";
  }

  function getRemainingCount() {
    const pending = Math.max(0, currentLevel().marbles - spawned);
    return chain.length + pending;
  }

  let hudLevel = -1;
  let hudScore = -1;
  let hudBest = -1;
  let hudRemaining = -1;
  let hudState = "";
  let barState = "";
  let barLevel = -1;
  function updateHud() {
    if (hudLevel !== levelIndex) {
      hudLevel = levelIndex;
      levelEl.textContent = String(levelIndex + 1) + " / " + String(LEVELS.length);
    }
    if (hudScore !== score) {
      hudScore = score;
      scoreEl.textContent = String(score);
    }
    if (hudBest !== best) {
      hudBest = best;
      bestEl.textContent = String(best);
    }
    const remaining = getRemainingCount();
    if (hudRemaining !== remaining) {
      hudRemaining = remaining;
      remainingEl.textContent = String(remaining);
    }
    if (hudState !== gameState) {
      hudState = gameState;
      stateEl.textContent = stateText();
    }
    if (barState !== gameState || barLevel !== levelIndex) {
      barState = gameState;
      barLevel = levelIndex;
      syncActionBar();
    }
  }

  function syncActionBar() {
    startBtn.style.display = "";
    pauseBtn.style.display = "none";
    restartBtn.style.display = "";
    fsBtn.style.display = "";
    startBtn.textContent = "Start";

    if (gameState === "running") {
      startBtn.style.display = "none";
      pauseBtn.style.display = "";
      restartBtn.style.display = "none";
      pauseBtn.textContent = "Pause";
      actionBar.classList.remove("hidden");
      return;
    }

    if (gameState === "paused") {
      startBtn.textContent = "Resume";
      actionBar.classList.remove("hidden");
      return;
    }

    if (gameState === "lost") {
      startBtn.textContent = "Retry";
      actionBar.classList.remove("hidden");
      return;
    }

    if (gameState === "cleared") {
      startBtn.textContent = levelIndex < LEVELS.length - 1 ? "Next Level" : "Finish";
      actionBar.classList.remove("hidden");
      return;
    }

    if (gameState === "complete") {
      startBtn.textContent = "Play Again";
      actionBar.classList.remove("hidden");
      return;
    }

    actionBar.classList.remove("hidden");
  }

  function setGameState(nextState, overlayText) {
    const prevState = gameState;
    gameState = nextState;
    if (nextState === "running") {
      if (prevState !== "running" && prevState !== "paused") {
        gameStartTime = Date.now();
        if (!runStartTime || levelIndex === 0 && score === 0) runStartTime = gameStartTime;
      }
      setOverlay("", false);
    } else if (nextState === "lost" || nextState === "complete") {
      const _dur = gameStartTime ? Math.round((Date.now() - gameStartTime) / 1000) : 0;
      gameStartTime = null;
      if (prevState === "running" && typeof window !== "undefined" && window.CartofiaGame) {
        window.CartofiaGame.reportResult({
          slug: "zuma",
          result: nextState === "complete" ? "win" : "loss",
          score: score,
          duration_seconds: _dur,
          extra: { level: levelIndex + 1,
                   run_seconds: runStartTime ? Math.round((Date.now() - runStartTime) / 1000) : _dur },
        });
      }
      if (nextState === "complete") runStartTime = null;
      if (typeof overlayText === "string") {
        setOverlay(overlayText, true);
      }
    } else if (typeof overlayText === "string") {
      setOverlay(overlayText, true);
    }
    updateHud();
    onStateFx(prevState, nextState);
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement);
  }

  function updateFullscreenButton() {
    fsBtn.textContent = isFullscreenActive() ? "Exit Full" : "Fullscreen";
  }

  function isPortraitViewport() {
    return window.matchMedia && window.matchMedia("(orientation: portrait)").matches;
  }

  function updateLandscapeTip() {
    const showTip = isCoarsePointer && isPortraitViewport() && !isFullscreenActive();
    landscapeTip.classList.toggle("hidden", !showTip);
  }

  async function requestFullscreenLandscape() {
    if (!isFullscreenActive() && boardFrame.requestFullscreen) {
      try {
        await boardFrame.requestFullscreen();
      } catch (_error) {
        // ignore fullscreen failures (for unsupported browsers)
      }
    }

    if (screen.orientation && screen.orientation.lock && isCoarsePointer) {
      try {
        await screen.orientation.lock("landscape");
      } catch (_error) {
        // ignore lock failures (common on iOS/Safari)
      }
    }

    updateFullscreenButton();
    updateLandscapeTip();
  }

  async function toggleFullscreen() {
    if (isFullscreenActive()) {
      if (document.exitFullscreen) {
        try {
          await document.exitFullscreen();
        } catch (_error) {
          // ignore exit failures
        }
      }
      updateFullscreenButton();
      updateLandscapeTip();
      return;
    }
    await requestFullscreenLandscape();
  }

  function getPathPoints(variant) {
    const v = variant % 3;
    if (v === 0) {
      return [
        { x: 76, y: 82 },
        { x: 822, y: 82 },
        { x: 822, y: 490 },
        { x: 140, y: 490 },
        { x: 140, y: 170 },
        { x: 742, y: 170 },
        { x: 742, y: 400 },
        { x: 230, y: 400 },
        { x: 230, y: 262 },
        { x: 600, y: 262 },
        { x: 600, y: 338 },
        { x: 450, y: 338 }
      ];
    }
    if (v === 1) {
      return [
        { x: 72, y: 288 },
        { x: 72, y: 92 },
        { x: 824, y: 92 },
        { x: 824, y: 470 },
        { x: 122, y: 470 },
        { x: 122, y: 172 },
        { x: 732, y: 172 },
        { x: 732, y: 392 },
        { x: 212, y: 392 },
        { x: 212, y: 252 },
        { x: 612, y: 252 },
        { x: 612, y: 324 },
        { x: 450, y: 324 }
      ];
    }
    return [
      { x: 82, y: 82 },
      { x: 820, y: 82 },
      { x: 710, y: 196 },
      { x: 152, y: 196 },
      { x: 258, y: 320 },
      { x: 760, y: 320 },
      { x: 652, y: 450 },
      { x: 122, y: 450 },
      { x: 226, y: 252 },
      { x: 620, y: 252 },
      { x: 520, y: 344 },
      { x: 450, y: 344 }
    ];
  }

  function compilePath(points) {
    const segments = [];
    let total = 0;

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.0001) {
        continue;
      }
      segments.push({
        a: a,
        b: b,
        dx: dx,
        dy: dy,
        len: len,
        ux: dx / len,
        uy: dy / len,
        start: total,
        end: total + len
      });
      total += len;
    }

    const first = segments[0];
    const last = segments[segments.length - 1];
    return {
      points: points,
      segments: segments,
      total: total,
      first: first,
      last: last
    };
  }

  function pointOnPath(distance) {
    if (distance <= 0) {
      return {
        x: path.first.a.x + (path.first.ux * distance),
        y: path.first.a.y + (path.first.uy * distance)
      };
    }
    if (distance >= path.total) {
      const over = distance - path.total;
      return {
        x: path.last.b.x + (path.last.ux * over),
        y: path.last.b.y + (path.last.uy * over)
      };
    }
    for (let i = 0; i < path.segments.length; i += 1) {
      const seg = path.segments[i];
      if (distance > seg.end) {
        continue;
      }
      const local = distance - seg.start;
      return {
        x: seg.a.x + (seg.ux * local),
        y: seg.a.y + (seg.uy * local)
      };
    }
    return { x: path.last.b.x, y: path.last.b.y };
  }

  function nearestDistanceOnPath(x, y) {
    let bestDistSq = Number.POSITIVE_INFINITY;
    let bestAlong = 0;

    for (let i = 0; i < path.segments.length; i += 1) {
      const seg = path.segments[i];
      const vx = x - seg.a.x;
      const vy = y - seg.a.y;
      const proj = clamp(((vx * seg.dx) + (vy * seg.dy)) / (seg.len * seg.len), 0, 1);
      const px = seg.a.x + (seg.dx * proj);
      const py = seg.a.y + (seg.dy * proj);
      const dx = x - px;
      const dy = y - py;
      const d2 = (dx * dx) + (dy * dy);
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestAlong = seg.start + (seg.len * proj);
      }
    }

    return bestAlong;
  }

  function availableColorPool() {
    const base = PALETTE.slice(0, currentLevel().colorCount);
    if (!chain.length) {
      return base;
    }
    const present = new Set();
    for (let i = 0; i < chain.length; i += 1) {
      present.add(chain[i].color);
    }
    const reduced = base.filter((color) => present.has(color));
    return reduced.length >= 2 ? reduced : base;
  }

  function randomColor() {
    const pool = availableColorPool();
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function ensureShooterColors() {
    if (!currentColor) {
      currentColor = randomColor();
    }
    if (!nextColor) {
      nextColor = randomColor();
    }
  }

  function addScore(amount) {
    score += amount;
    if (score > best) {
      best = score;
      saveBest();
    }
  }

  function spawnBurst(x, y, color, amount, force) {
    // visual only: pop ghost + ring + shards + sparks for one cleared marble
    const ci = styleIndex(color);
    addPop(x, y, ci);
    addPart(KIND_RING, x, y, 0, 0, 0.36, 10, ci);
    if (reducedMotion) {
      return;
    }
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = ((force * 0.45) + (Math.random() * force)) * 1.25;
      addPart(KIND_SHARD, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.45 + (Math.random() * 0.35), 2.2 + (Math.random() * 2.2), ci);
    }
    for (let i = 0; i < 3; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = force * (0.5 + Math.random());
      addPart(KIND_SPARK, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.3 + (Math.random() * 0.3), 6 + (Math.random() * 5), i ? ci : CI_WHITE);
    }
  }

  function enforceMinimumSpacing() {
    if (chain.length < 2) {
      return;
    }
    for (let i = 1; i < chain.length; i += 1) {
      const minOffset = chain[i - 1].offset + BALL_SPACING;
      if (chain[i].offset < minOffset) {
        chain[i].offset = minOffset;
      }
    }
  }

  function compactChain(maxClosePerStep) {
    if (chain.length < 2) {
      return;
    }
    for (let i = 1; i < chain.length; i += 1) {
      const target = chain[i - 1].offset + BALL_SPACING;
      if (chain[i].offset < target) {
        chain[i].offset = target;
        continue;
      }
      const closed = chain[i].offset - maxClosePerStep;
      chain[i].offset = closed < target ? target : closed;
    }
  }

  function resolveMatches(startIndex) {
    let index = startIndex;
    let combo = 1;

    while (index >= 0 && index < chain.length) {
      const color = chain[index].color;
      let left = index;
      let right = index;

      while (left > 0 && chain[left - 1].color === color) {
        left -= 1;
      }
      while (right + 1 < chain.length && chain[right + 1].color === color) {
        right += 1;
      }

      const count = right - left + 1;
      if (count < 3) {
        break;
      }

      const removed = chain.slice(left, right + 1);
      for (let i = 0; i < removed.length; i += 1) {
        const p = pointOnPath(removed[i].offset);
        spawnBurst(p.x, p.y, removed[i].color, 5, 120);
      }
      fxMatch(removed, count * 60 * combo, combo);
      chain.splice(left, count);
      addScore(count * 60 * combo);
      combo += 1;

      if (!chain.length) {
        break;
      }

      if (left > 0 && left < chain.length && chain[left - 1].color === chain[left].color) {
        index = left;
        continue;
      }

      index = Math.min(left, chain.length - 1);
    }
  }

  function spawnBallAtStart() {
    // Always anchor spawns to the start hole; only shift slightly behind it if needed for spacing.
    const headOffset = chain.length ? chain[0].offset : Number.POSITIVE_INFINITY;
    const offset = Math.min(SPAWN_HOLE_OFFSET, headOffset - BALL_SPACING);
    chain.unshift({
      id: ++shotId,
      offset: offset,
      color: randomColor()
    });
    chain[0].vBorn = frameNow;
    spawned += 1;
  }

  function loadLevel(index, keepScore) {
    levelIndex = clamp(index, 0, LEVELS.length - 1);
    path = compilePath(getPathPoints(currentLevel().path));
    chain = [];
    shots = [];
    resetFx();
    spawned = 0;
    spawnTimer = 0;
    currentColor = null;
    nextColor = null;
    aimAngle = -Math.PI / 2;

    if (!keepScore) {
      score = 0;
    }

    ensureShooterColors();
    setGameState("ready", "Level " + String(levelIndex + 1) + ": " + currentLevel().name + ". Press Start.");
  }

  function startOrAdvance() {
    if (gameState === "running") {
      return;
    }

    if (gameState === "paused") {
      setGameState("running");
      return;
    }

    if (gameState === "lost") {
      loadLevel(levelIndex, true);
      setGameState("running");
      return;
    }

    if (gameState === "cleared") {
      if (levelIndex < LEVELS.length - 1) {
        loadLevel(levelIndex + 1, true);
        setGameState("running");
        return;
      }
      setGameState("complete", "All levels cleared. Press Play Again for a fresh run.");
      return;
    }

    if (gameState === "complete") {
      loadLevel(0, false);
      setGameState("running");
      return;
    }

    // ready
    setGameState("running");
  }

  function restartRun() {
    loadLevel(0, false);
  }

  function pauseGame() {
    if (gameState !== "running") {
      return;
    }
    setGameState("paused", "Paused. Press Resume to continue.");
  }

  function updateAimFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (WIDTH / rect.width);
    const y = (clientY - rect.top) * (HEIGHT / rect.height);
    aimAngle = Math.atan2(y - SHOOTER_Y, x - SHOOTER_X);
  }

  function swapShooterColors() {
    const temp = currentColor;
    currentColor = nextColor;
    nextColor = temp;
    fxSwap();
  }

  function shootBall() {
    if (gameState !== "running") {
      return;
    }

    ensureShooterColors();
    const speed = currentLevel().shotSpeed;
    const cx = Math.cos(aimAngle);
    const cy = Math.sin(aimAngle);
    const startOffset = SHOOTER_RADIUS + BALL_RADIUS + 4;

    shots.push({
      id: ++shotId,
      x: SHOOTER_X + (cx * startOffset),
      y: SHOOTER_Y + (cy * startOffset),
      vx: cx * speed,
      vy: cy * speed,
      color: currentColor
    });

    currentColor = nextColor;
    nextColor = randomColor();
    if (nextColor === currentColor && Math.random() < 0.25) {
      nextColor = randomColor();
    }
    fxShoot();
  }

  function updateSpawn(dt) {
    if (spawned >= currentLevel().marbles) {
      return;
    }

    if (!chain.length) {
      spawnBallAtStart();
      spawnTimer = 0;
      return;
    }

    spawnTimer += dt;
    if (spawnTimer >= currentLevel().spawnInterval) {
      spawnBallAtStart();
      spawnTimer = 0;
    }
  }

  function updateChain(dt) {
    const move = currentLevel().speed * dt;
    for (let i = 0; i < chain.length; i += 1) {
      chain[i].offset += move;
    }

    compactChain(currentLevel().compress * dt);

    if (chain.length && chain[chain.length - 1].offset >= path.total - END_MARGIN) {
      setGameState("lost", "The chain reached the skull. Press Retry.");
    }
  }

  function insertShotIntoChain(shotX, shotY, color) {
    const along = nearestDistanceOnPath(shotX, shotY);
    const ball = {
      id: ++shotId,
      offset: along,
      color: color
    };

    for (let i = 0; i < chain.length; i += 1) {
      chain[i].vPrev = chain[i].offset;
    }
    chain.push(ball);
    chain.sort((a, b) => a.offset - b.offset);
    enforceMinimumSpacing();
    for (let i = 0; i < chain.length; i += 1) {
      const m = chain[i];
      if (m !== ball && typeof m.vPrev === "number") {
        m.vd = (m.vd || 0) + (m.offset - m.vPrev);
      }
    }
    ball.vIx = shotX;
    ball.vIy = shotY;
    ball.vIt = frameNow;

    const inserted = chain.findIndex((entry) => entry.id === ball.id);
    resolveMatches(inserted);
  }

  function updateShots(dt) {
    const collisionRadius = (BALL_RADIUS * 2) - 2;
    const collisionSq = collisionRadius * collisionRadius;

    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;

      if (
        shot.x < -BALL_RADIUS ||
        shot.x > WIDTH + BALL_RADIUS ||
        shot.y < -BALL_RADIUS ||
        shot.y > HEIGHT + BALL_RADIUS
      ) {
        shots.splice(i, 1);
        continue;
      }

      let hit = false;
      for (let j = 0; j < chain.length; j += 1) {
        const p = pointOnPath(chain[j].offset);
        const dx = shot.x - p.x;
        const dy = shot.y - p.y;
        const d2 = (dx * dx) + (dy * dy);
        if (d2 > collisionSq) {
          continue;
        }
        insertShotIntoChain(shot.x, shot.y, shot.color);
        shots.splice(i, 1);
        hit = true;
        break;
      }

      if (hit) {
        continue;
      }
    }
  }

  function checkWinCondition() {
    if (
      spawned >= currentLevel().marbles &&
      chain.length === 0 &&
      shots.length === 0 &&
      gameState === "running"
    ) {
      addScore(250 + (levelIndex * 90));
      if (levelIndex < LEVELS.length - 1) {
        setGameState("cleared", "Level clear. Press Next Level.");
      } else {
        setGameState("complete", "All levels cleared. Press Play Again.");
      }
    }
  }

  function updateGame(dt) {
    if (gameState !== "running") {
      return;
    }
    updateSpawn(dt);
    updateChain(dt);
    if (gameState !== "running") {
      return;
    }
    updateShots(dt);
    checkWinCondition();
  }

  /* ==========================================================================
     ART: everything below is presentation only. It reads the game state above
     but never changes rules, timing, scoring or RNG used by the game.
     Logical space stays 900 x 560; the canvas backing store is DPR-scaled.
     ========================================================================== */
  const TAU = Math.PI * 2;
  const MAX_DPR = 2;
  const INK = "#1b1230";
  const TEAL = "#2cc6b4";

  // Visual style per palette entry (logic still compares the PALETTE strings).
  // Each colour also carries a symbol so colour is never the only cue.
  const MARBLE = [
    { base: "#ff3d5e", light: "#ffa3b4", dark: "#c8183e", deep: "#6a0a22", sym: "diamond", inkLight: true },
    { base: "#2f8cff", light: "#a8d1ff", dark: "#1557d6", deep: "#0a2a78", sym: "ring", inkLight: true },
    { base: "#ffcf2e", light: "#fff4b4", dark: "#e09600", deep: "#7a4c00", sym: "star", inkLight: false },
    { base: "#2fd27a", light: "#adf7cb", dark: "#11975a", deep: "#06492a", sym: "tri", inkLight: false },
    { base: "#a46bff", light: "#ddc6ff", dark: "#6f35de", deep: "#30117a", sym: "moon", inkLight: true },
    { base: "#ff8a2a", light: "#ffca9a", dark: "#d75800", deep: "#682a00", sym: "cross", inkLight: false }
  ];
  const CI_GOLD = 6;
  const CI_RED = 7;
  const CI_WHITE = 8;
  const CI_TEAL = 9;
  const CI_FIRE = 10;
  const FX_BASE = ["#ff3d5e", "#2f8cff", "#ffcf2e", "#2fd27a", "#a46bff", "#ff8a2a", "#ffd76a", "#ff4a5e", "#ffffff", "#5ff0dc", "#ff9a3c"];
  const FX_LIGHT = ["#ffa3b4", "#a8d1ff", "#fff4b4", "#adf7cb", "#ddc6ff", "#ffca9a", "#fff1b8", "#ff9aa8", "#ffffff", "#c8fff6", "#ffd9a0"];

  // One look per temple: hue family, motif engraved in the floor, mote colour.
  const THEMES = [
    { hue: 174, sat: 58, lit: 27, motif: "sun", mote: "#ffe7a8", moss: "#7fd39a" },     // Temple Entry
    { hue: 192, sat: 30, lit: 25, motif: "glyph", mote: "#cfe9ff", moss: "#8fc7b0" },   // Stone Gallery
    { hue: 150, sat: 46, lit: 23, motif: "jaguar", mote: "#ffe08a", moss: "#9ad36b" },  // Jaguar Gate
    { hue: 34, sat: 40, lit: 20, motif: "sun", mote: "#ffd27a", moss: "#c8b45a" },      // Sunway
    { hue: 222, sat: 36, lit: 22, motif: "moon", mote: "#dfe6ff", moss: "#8fa8d8" },    // Moon Terrace
    { hue: 158, sat: 60, lit: 20, motif: "glyph", mote: "#b8ffd8", moss: "#5fe0a0" },   // Emerald Hall
    { hue: 262, sat: 26, lit: 16, motif: "stars", mote: "#d9c8ff", moss: "#9d86d8" },   // Obsidian Span
    { hue: 186, sat: 50, lit: 19, motif: "moon", mote: "#a8f0ff", moss: "#6fc8c8" },    // Oracle Route
    { hue: 20, sat: 44, lit: 21, motif: "glyph", mote: "#ffc08a", moss: "#d08f5a" },    // Temple Core
    { hue: 40, sat: 44, lit: 19, motif: "sun", mote: "#fff0a0", moss: "#e0c060" },      // Solar Vault
    { hue: 236, sat: 44, lit: 17, motif: "stars", mote: "#e8ecff", moss: "#8a9cff" },   // Celestial Rift
    { hue: 350, sat: 40, lit: 19, motif: "jaguar", mote: "#ffd0a0", moss: "#e08a8a" }   // Apex Idol
  ];

  const BRAZIERS = [{ x: 40, y: 522, ph: 0.3 }, { x: 860, y: 522, ph: 2.1 }];

  const reduceMQ = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reducedMotion = Boolean(reduceMQ && reduceMQ.matches);
  if (reduceMQ) {
    const onReduceChange = () => { reducedMotion = reduceMQ.matches; };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", onReduceChange);
    else if (reduceMQ.addListener) reduceMQ.addListener(onReduceChange);
  }

  // one clock for every effect timestamp: the rAF frame time (event handlers use the last frame's)
  let frameNow = performance.now();
  let scaleX = 1;
  let scaleY = 1;
  let cssW = 0;
  let uiScale = 1;
  let layer = null;
  let layerDirty = true;
  let spr = null;
  let accent = "#7c5cff";
  let accentLight = "#b9a6ff";
  let progGrad = null;
  let progGeom = { x: 0, y: 0, w: 0, h: 0 };
  let danger = 0;
  let theme = THEMES[0];

  // effect pools (allocated once)
  const KIND_SPARK = 0;
  const KIND_SHARD = 1;
  const KIND_RING = 2;
  const P_MAX = 360;
  const parts = [];
  for (let i = 0; i < P_MAX; i += 1) {
    parts.push({ kind: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, rot: 0, vr: 0, ci: 0 });
  }
  let pCount = 0;
  const POP_MAX = 64;
  const pops = [];
  for (let i = 0; i < POP_MAX; i += 1) pops.push({ x: 0, y: 0, ci: 0, t0: 0 });
  let popCount = 0;
  const TXT_MAX = 16;
  const txts = [];
  for (let i = 0; i < TXT_MAX; i += 1) txts.push({ x: 0, y: 0, t0: 0, dur: 1, text: "", font: "", fill: "#fff", rise: 30 });
  let txtCount = 0;
  const chainLbl = { x: 0, y: 0, t0: -1e9, dur: 1200, text: "", font: "", fill: "#ff8a5c", rise: 26 };
  let lastMatchFxT = -1e9;
  let matchStack = 0;
  const banner = { t0: -1e9, kicker: "", title: "" };
  let shakeT = -1e9;
  let shakeAmp = 0;
  let lossT = -1e9;
  let clearT = -1e9;
  let clearBurstDone = true;
  let shootT = -1e9;
  let swapT = -1e9;

  const motes = [];
  (function buildMotes() {
    const r = mulberry32(4242);
    for (let i = 0; i < 18; i += 1) {
      motes.push({ x: 30 + r() * 840, y: r() * HEIGHT, sp: 6 + r() * 10, ph: r() * TAU, s: 3 + r() * 4 });
    }
  })();

  // scratch buffers for chain rendering (grown only if a chain ever exceeds them)
  let bufX = new Float32Array(256);
  let bufY = new Float32Array(256);
  let bufS = new Float32Array(256);

  // path sampling without allocation (same math as pointOnPath)
  let PX = 0;
  let PY = 0;
  let UX = 1;
  let UY = 0;
  let SEG_IN = 0;
  function samplePath(distance) {
    if (distance <= 0) {
      const s = path.first;
      PX = s.a.x + (s.ux * distance); PY = s.a.y + (s.uy * distance); UX = s.ux; UY = s.uy; SEG_IN = 0;
      return;
    }
    if (distance >= path.total) {
      const s = path.last;
      const over = distance - path.total;
      PX = s.b.x + (s.ux * over); PY = s.b.y + (s.uy * over); UX = s.ux; UY = s.uy; SEG_IN = 0;
      return;
    }
    const segs = path.segments;
    for (let i = 0; i < segs.length; i += 1) {
      const s = segs[i];
      if (distance > s.end) continue;
      const local = distance - s.start;
      PX = s.a.x + (s.ux * local); PY = s.a.y + (s.uy * local); UX = s.ux; UY = s.uy;
      SEG_IN = Math.min(local, s.end - distance);
      return;
    }
    PX = path.last.b.x; PY = path.last.b.y;
  }

  /* ---------- small helpers ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hsl(h, s, l, a) {
    return "hsla(" + h.toFixed(1) + ", " + s.toFixed(1) + "%, " + l.toFixed(1) + "%, " + (a == null ? 1 : a) + ")";
  }
  function parseColor(c) {
    const s = String(c || "").trim();
    let m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    m = s.match(/^#([0-9a-f]{6})/i);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
  }
  function rgba(rgb, a) {
    return "rgba(" + Math.round(rgb[0]) + ", " + Math.round(rgb[1]) + ", " + Math.round(rgb[2]) + ", " + a + ")";
  }
  function hexA(hex, a) {
    return rgba(parseColor(hex) || [255, 255, 255], a);
  }
  function mix(rgb, rgb2, t) {
    return [rgb[0] + ((rgb2[0] - rgb[0]) * t), rgb[1] + ((rgb2[1] - rgb[1]) * t), rgb[2] + ((rgb2[2] - rgb[2]) * t)];
  }
  function easeOutCubic(t) { const u = 1 - t; return 1 - (u * u * u); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - (Math.pow((-2 * t) + 2, 3) / 2); }
  function easeOutBack(t) { const c1 = 1.70158; const c3 = c1 + 1; const u = t - 1; return 1 + (c3 * u * u * u) + (c1 * u * u); }
  function styleIndex(color) {
    const i = PALETTE.indexOf(color);
    return i < 0 ? 0 : i;
  }
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function rr(g, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }
  function tracePath(g) {
    g.beginPath();
    g.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i += 1) g.lineTo(path.points[i].x, path.points[i].y);
  }
  function traceSub(g, d0, d1) {
    samplePath(d0);
    g.beginPath();
    g.moveTo(PX, PY);
    const segs = path.segments;
    for (let i = 0; i < segs.length; i += 1) {
      const e = segs[i].end;
      if (e > d0 && e < d1) g.lineTo(segs[i].b.x, segs[i].b.y);
    }
    samplePath(d1);
    g.lineTo(PX, PY);
  }

  function readAccent() {
    try {
      const v = getComputedStyle(document.body || document.documentElement).getPropertyValue("--accent");
      const rgb = parseColor(v);
      if (rgb) {
        accent = rgba(rgb, 1);
        accentLight = rgba(mix(rgb, [255, 255, 255], 0.45), 1);
      }
    } catch (_error) {
      // keep defaults
    }
  }

  /* ---------- sizing (DPR aware) ---------- */
  function syncCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(rect.width * ratio));
    const h = Math.max(1, Math.round(rect.height * ratio));
    const plaqueBefore = cssW >= 520;
    cssW = rect.width;
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
      layerDirty = true;
    }
    if (plaqueBefore !== (cssW >= 520)) layerDirty = true;
    scaleX = canvas.width / WIDTH;
    scaleY = canvas.height / HEIGHT;
    const nextUi = clamp((WIDTH / cssW) * 0.62, 1, 1.7);
    if (Math.abs(nextUi - uiScale) > 0.01) { uiScale = nextUi; layerDirty = true; }
  }

  /* ---------- sprites ---------- */
  function symbolPath(g, sym, s) {
    g.beginPath();
    if (sym === "diamond") {
      g.moveTo(0, -s * 1.08); g.lineTo(s * 0.8, 0); g.lineTo(0, s * 1.08); g.lineTo(-s * 0.8, 0); g.closePath();
    } else if (sym === "ring") {
      g.arc(0, 0, s * 0.92, 0, TAU);
      g.moveTo(s * 0.44, 0);
      g.arc(0, 0, s * 0.44, 0, TAU, true);
    } else if (sym === "star") {
      for (let i = 0; i < 8; i += 1) {
        const a = (-Math.PI / 2) + (i * Math.PI / 4);
        const r = (i % 2) ? s * 0.38 : s * 1.1;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
    } else if (sym === "tri") {
      g.moveTo(0, -s * 0.98); g.lineTo(s * 0.95, s * 0.7); g.lineTo(-s * 0.95, s * 0.7); g.closePath();
    } else if (sym === "moon") {
      const r1 = s * 1.0;
      const d = s * 0.56;
      const r2 = s * 0.82;
      const x = ((r1 * r1) - (r2 * r2) + (d * d)) / (2 * d);
      const y = Math.sqrt(Math.max(0, (r1 * r1) - (x * x)));
      const t1 = Math.atan2(y, x);
      const t2 = Math.atan2(y, x - d);
      g.save();
      g.rotate(-0.55);
      g.moveTo(x, -y);
      g.arc(0, 0, r1, -t1, t1, true);
      g.arc(d, 0, r2, t2, -t2, false);
      g.closePath();
      g.restore();
    } else {
      const t = s * 0.3;
      const L = s * 0.98;
      g.moveTo(-t, -L); g.lineTo(t, -L); g.lineTo(t, -t); g.lineTo(L, -t); g.lineTo(L, t); g.lineTo(t, t);
      g.lineTo(t, L); g.lineTo(-t, L); g.lineTo(-t, t); g.lineTo(-L, t); g.lineTo(-L, -t); g.lineTo(-t, -t); g.closePath();
    }
  }

  function paintMarble(g, R, m) {
    let gr = g.createRadialGradient(-R * 0.34, -R * 0.4, R * 0.05, 0, 0, R * 1.06);
    gr.addColorStop(0, m.light);
    gr.addColorStop(0.36, m.base);
    gr.addColorStop(0.8, m.dark);
    gr.addColorStop(1, m.deep);
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    // glassy bounce light from below
    g.save();
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.clip();
    gr = g.createRadialGradient(R * 0.3, R * 0.62, 0, R * 0.3, R * 0.62, R * 0.8);
    gr.addColorStop(0, hexA(m.light, 0.6));
    gr.addColorStop(1, hexA(m.light, 0));
    g.fillStyle = gr;
    g.fillRect(-R, -R, R * 2, R * 2);
    g.restore();
    // inlaid symbol (engraved edge + face)
    const s = R * 0.5;
    g.save();
    g.translate(0, R * 0.04);
    g.save();
    g.translate(0, 0.75);
    symbolPath(g, m.sym, s);
    g.fillStyle = m.inkLight ? hexA(m.deep, 0.9) : hexA(m.light, 0.75);
    g.fill();
    g.restore();
    symbolPath(g, m.sym, s);
    g.fillStyle = m.inkLight ? "rgba(255, 255, 255, 0.94)" : hexA(m.deep, 0.92);
    g.fill();
    g.restore();
    // specular highlight
    g.save();
    g.translate(-R * 0.36, -R * 0.45);
    g.rotate(-0.62);
    g.scale(1, 0.56);
    gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.48);
    gr.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    gr.addColorStop(0.55, "rgba(255, 255, 255, 0.55)");
    gr.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, R * 0.48, 0, TAU);
    g.fill();
    g.restore();
    g.beginPath();
    g.arc(R * 0.46, R * 0.4, R * 0.09, 0, TAU);
    g.fillStyle = "rgba(255, 255, 255, 0.55)";
    g.fill();
    // rim light + ink outline
    g.beginPath();
    g.arc(0, 0, R - 1.3, 0.15, 1.75);
    g.lineWidth = 1.1;
    g.strokeStyle = "rgba(255, 255, 255, 0.28)";
    g.stroke();
    g.beginPath();
    g.arc(0, 0, R - 0.2, 0, TAU);
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(18, 10, 34, 0.92)";
    g.stroke();
  }

  function makeGlow(k, size, color) {
    const c = makeCanvas(size * k, size * k);
    const g = c.getContext("2d");
    const rgb = parseColor(color) || [255, 255, 255];
    const r = (size * k) / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, rgba(rgb, 1));
    gr.addColorStop(0.22, rgba(rgb, 0.55));
    gr.addColorStop(0.55, rgba(rgb, 0.14));
    gr.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function makeSoftDisc(k, size, alpha, inner) {
    const c = makeCanvas(size * k, size * k);
    const g = c.getContext("2d");
    const r = (size * k) / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, "rgba(0, 0, 0, " + alpha + ")");
    gr.addColorStop(inner, "rgba(0, 0, 0, " + (alpha * 0.7) + ")");
    gr.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function paintTurret(g) {
    g.lineJoin = "round";
    g.lineCap = "round";
    const rayGrad = g.createRadialGradient(0, 0, 18, 0, 0, 37);
    rayGrad.addColorStop(0, "#fff0b0");
    rayGrad.addColorStop(0.45, "#f2c94c");
    rayGrad.addColorStop(1, "#b07f22");
    for (let i = 1; i < 12; i += 1) {
      const a = (-Math.PI / 2) + (i * TAU / 12);
      const long = (i % 2) === 0;
      const r0 = 21.5;
      const r1 = long ? 36 : 31.5;
      const hw = long ? 0.25 : 0.28;
      g.beginPath();
      g.moveTo(Math.cos(a - hw) * r0, Math.sin(a - hw) * r0);
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.lineTo(Math.cos(a + hw) * r0, Math.sin(a + hw) * r0);
      g.closePath();
      g.fillStyle = rayGrad;
      g.fill();
      g.lineWidth = 1.6;
      g.strokeStyle = INK;
      g.stroke();
      if (long) {
        g.beginPath();
        g.arc(Math.cos(a) * (r1 - 7.5), Math.sin(a) * (r1 - 7.5), 2.1, 0, TAU);
        g.fillStyle = TEAL;
        g.fill();
        g.lineWidth = 1;
        g.stroke();
      }
    }
    // muzzle collar (front)
    let gr = g.createLinearGradient(-9, 0, 9, 0);
    gr.addColorStop(0, "#9c6f1c");
    gr.addColorStop(0.42, "#ffe9a0");
    gr.addColorStop(1, "#b98a2c");
    rr(g, -8.5, -34, 17, 16, 4);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = INK;
    g.stroke();
    rr(g, -10.5, -37, 21, 6, 3);
    g.fillStyle = "#d9a93a";
    g.fill();
    g.lineWidth = 1.8;
    g.stroke();
    g.beginPath();
    g.moveTo(-8, -35.5);
    g.lineTo(8, -35.5);
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255, 243, 190, 0.8)";
    g.stroke();
    // sun disc
    gr = g.createRadialGradient(-8, -9, 2, 0, 0, 26);
    gr.addColorStop(0, "#fff4c4");
    gr.addColorStop(0.45, "#f2c94c");
    gr.addColorStop(0.85, "#c6952f");
    gr.addColorStop(1, "#946a1c");
    g.beginPath();
    g.arc(0, 0, 25, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 19.6, 0, TAU);
    g.lineWidth = 1.4;
    g.strokeStyle = "rgba(96, 62, 10, 0.55)";
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 20.8, Math.PI * 1.05, Math.PI * 1.95);
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255, 246, 205, 0.55)";
    g.stroke();
    // dotted band on the back half (cover motif)
    g.fillStyle = "rgba(110, 72, 14, 0.6)";
    for (let a = 1.4; a <= (Math.PI * 2) - 1.4; a += 0.36) {
      const ang = (-Math.PI / 2) + a;
      g.beginPath();
      g.arc(Math.cos(ang) * 22.4, Math.sin(ang) * 22.4, 0.95, 0, TAU);
      g.fill();
    }
    // eyes
    for (let s = -1; s <= 1; s += 2) {
      const a = (-Math.PI / 2) + (s * 0.95);
      g.save();
      g.translate(Math.cos(a) * 19.4, Math.sin(a) * 19.4);
      g.rotate(a + (Math.PI / 2));
      g.beginPath();
      g.ellipse(0, 0, 4.4, 2.7, 0, 0, TAU);
      g.fillStyle = INK;
      g.fill();
      g.beginPath();
      g.ellipse(0, -0.6, 3.2, 1.2, 0, Math.PI, TAU);
      g.lineWidth = 0.8;
      g.strokeStyle = "rgba(255, 240, 190, 0.5)";
      g.stroke();
      g.restore();
    }
    // chevron (straight from the cover art)
    g.beginPath();
    g.moveTo(-4.6, -16.1);
    g.lineTo(0, -20.3);
    g.lineTo(4.6, -16.1);
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 1.5;
    g.strokeStyle = "#fff3b0";
    g.stroke();
    // obsidian core (holds the next marble)
    gr = g.createRadialGradient(-4, -5, 1, 0, 0, 15);
    gr.addColorStop(0, "#3d3352");
    gr.addColorStop(0.6, "#140d22");
    gr.addColorStop(1, "#05030a");
    g.beginPath();
    g.arc(0, 0, 14.4, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2.4;
    g.strokeStyle = INK;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 12.9, 0, TAU);
    g.lineWidth = 1;
    g.strokeStyle = "rgba(255, 222, 140, 0.45)";
    g.stroke();
  }

  function paintSkull(g) {
    g.scale(1.15, 1.15);
    g.lineJoin = "round";
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, -3, 12.5, Math.PI - 0.5, 0.5, false);
    g.lineTo(8, 7);
    g.quadraticCurveTo(8, 12.5, 4, 12.6);
    g.lineTo(-4, 12.6);
    g.quadraticCurveTo(-8, 12.5, -8, 7);
    g.closePath();
    const gr = g.createLinearGradient(0, -16, 0, 13);
    gr.addColorStop(0, "#f7f0dc");
    gr.addColorStop(0.55, "#d8caa4");
    gr.addColorStop(1, "#9c8a62");
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2.2;
    g.strokeStyle = INK;
    g.stroke();
    // gold temple band
    g.beginPath();
    g.arc(0, -3, 10.4, Math.PI + 0.55, -0.55);
    g.lineWidth = 4.4;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 2.4;
    g.strokeStyle = "#f2c94c";
    g.stroke();
    g.beginPath();
    g.arc(0, -13.4, 1.6, 0, TAU);
    g.fillStyle = TEAL;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = INK;
    g.stroke();
    // sockets
    for (let s = -1; s <= 1; s += 2) {
      g.beginPath();
      g.ellipse(s * 4.9, -1.8, 3.7, 4.3, s * 0.22, 0, TAU);
      g.fillStyle = "#170910";
      g.fill();
    }
    // nose
    g.beginPath();
    g.moveTo(0, 2.6);
    g.lineTo(-1.9, 5.8);
    g.lineTo(1.9, 5.8);
    g.closePath();
    g.fillStyle = "#2a1620";
    g.fill();
    // teeth
    g.beginPath();
    g.moveTo(-6, 9.2);
    g.lineTo(6, 9.2);
    for (let i = -1.5; i <= 1.5; i += 1) {
      g.moveTo(i * 2.8, 7.4);
      g.lineTo(i * 2.8, 11.9);
    }
    g.lineWidth = 1;
    g.strokeStyle = "rgba(27, 18, 48, 0.75)";
    g.stroke();
    // crack
    g.beginPath();
    g.moveTo(6.2, -12.6);
    g.lineTo(4.6, -9.8);
    g.lineTo(6.4, -8);
    g.lineTo(5, -5.6);
    g.lineWidth = 0.9;
    g.strokeStyle = "rgba(70, 45, 30, 0.65)";
    g.stroke();
  }

  function buildSprites() {
    const k = scaleX;
    const R = BALL_RADIUS;
    const mSize = (R + 3) * 2;
    const marbles = [];
    for (let i = 0; i < MARBLE.length; i += 1) {
      const c = makeCanvas(mSize * k, mSize * k);
      const g = c.getContext("2d");
      g.setTransform(k, 0, 0, k, (mSize * k) / 2, (mSize * k) / 2);
      paintMarble(g, R, MARBLE[i]);
      marbles.push(c);
    }
    const glows = [];
    for (let i = 0; i < FX_BASE.length; i += 1) glows.push(makeGlow(k, 32, FX_BASE[i]));
    const tSize = 84;
    const turret = makeCanvas(tSize * k, tSize * k);
    const tg = turret.getContext("2d");
    tg.setTransform(k, 0, 0, k, (tSize * k) / 2, (tSize * k) / 2);
    paintTurret(tg);
    const sSize = 40;
    const skull = makeCanvas(sSize * k, sSize * k);
    const sg = skull.getContext("2d");
    sg.setTransform(k, 0, 0, k, (sSize * k) / 2, (sSize * k) / 2);
    paintSkull(sg);
    spr = {
      k: k,
      mSize: mSize,
      marbles: marbles,
      shadow: makeSoftDisc(k, 34, 0.55, 0.45),
      glows: glows,
      tSize: tSize,
      turret: turret,
      turretShadow: makeSoftDisc(k, 84, 0.5, 0.55),
      sSize: sSize,
      skull: skull,
      redVig: makeVignette([255, 40, 70]),
      goldVig: makeVignette([255, 205, 90])
    };
  }

  function makeVignette(rgb) {
    const c = makeCanvas(225, 140);
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(112.5, 70, 40, 112.5, 70, 140);
    gr.addColorStop(0, rgba(rgb, 0));
    gr.addColorStop(0.55, rgba(rgb, 0.08));
    gr.addColorStop(1, rgba(rgb, 0.55));
    g.fillStyle = gr;
    g.fillRect(0, 0, 225, 140);
    return c;
  }

  /* ---------- the cached temple layer (floor + track + portal + pit) ---------- */
  function engrave(g, build, darkA, lightA, width) {
    g.lineWidth = width;
    g.save();
    g.translate(0.7, 1.1);
    build(g);
    g.strokeStyle = "rgba(0, 0, 0, " + darkA + ")";
    g.stroke();
    g.restore();
    g.save();
    g.translate(-0.4, -0.5);
    build(g);
    g.strokeStyle = "rgba(255, 244, 214, " + lightA + ")";
    g.stroke();
    g.restore();
  }

  function paintFloor(g, th, rng) {
    const cIn = hsl(th.hue, th.sat, th.lit);
    const cMid = hsl(th.hue, th.sat * 0.92, th.lit * 0.62);
    const cOut = hsl(th.hue, th.sat * 0.8, th.lit * 0.28);
    let gr = g.createRadialGradient(450, 250, 30, 450, 290, 560);
    gr.addColorStop(0, cIn);
    gr.addColorStop(0.55, cMid);
    gr.addColorStop(1, cOut);
    g.fillStyle = gr;
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // dot texture (from the cover)
    g.fillStyle = "rgba(255, 255, 255, 0.05)";
    for (let y = 6; y < HEIGHT; y += 12) {
      for (let x = 6; x < WIDTH; x += 12) g.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }

    // flagstones
    const SW = 100;
    const SH = 74;
    g.lineJoin = "round";
    for (let row = 0, y = -20; y < HEIGHT; row += 1, y += SH) {
      const off = (row % 2) ? -SW / 2 : 0;
      for (let x = off - 12; x < WIDTH; x += SW) {
        const v = rng();
        rr(g, x + 2, y + 2, SW - 4, SH - 4, 7);
        g.fillStyle = v < 0.55 ? "rgba(255, 255, 255, " + (0.015 + (v * 0.07)).toFixed(3) + ")" : "rgba(0, 0, 0, " + ((v - 0.55) * 0.22).toFixed(3) + ")";
        g.fill();
        g.lineWidth = 2.4;
        g.strokeStyle = "rgba(0, 0, 0, 0.3)";
        g.stroke();
        g.beginPath();
        g.moveTo(x + 5, y + SH - 7);
        g.lineTo(x + 5, y + 5);
        g.lineTo(x + SW - 7, y + 5);
        g.lineWidth = 1.2;
        g.strokeStyle = "rgba(255, 255, 255, 0.07)";
        g.stroke();
      }
    }

    // speckles
    for (let i = 0; i < 700; i += 1) {
      const x = rng() * WIDTH;
      const y = rng() * HEIGHT;
      const s = 0.5 + (rng() * 1.1);
      g.fillStyle = rng() < 0.5 ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.12)";
      g.fillRect(x, y, s, s);
    }

    // moss pools
    const moss = parseColor(th.moss) || [120, 200, 140];
    for (let i = 0; i < 14; i += 1) {
      const x = rng() * WIDTH;
      const y = rng() * HEIGHT;
      const r = 22 + (rng() * 40);
      gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(moss, 0.1));
      gr.addColorStop(1, rgba(moss, 0));
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // cracks
    g.lineCap = "round";
    for (let i = 0; i < 12; i += 1) {
      let x = rng() * WIDTH;
      let y = rng() * HEIGHT;
      let a = rng() * TAU;
      g.beginPath();
      g.moveTo(x, y);
      const n = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < n; j += 1) {
        a += (rng() - 0.5) * 1.4;
        x += Math.cos(a) * (6 + (rng() * 12));
        y += Math.sin(a) * (6 + (rng() * 12));
        g.lineTo(x, y);
      }
      g.lineWidth = 1;
      g.strokeStyle = "rgba(0, 0, 0, 0.32)";
      g.stroke();
    }

    paintMotif(g, th, rng);

    // warm light shafts
    g.save();
    for (let i = 0; i < 2; i += 1) {
      const x0 = 90 + (i * 170);
      gr = g.createLinearGradient(0, 0, 0, HEIGHT);
      gr.addColorStop(0, "rgba(255, 236, 180, 0.075)");
      gr.addColorStop(1, "rgba(255, 236, 180, 0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0, 0);
      g.lineTo(x0 + 90 + (i * 20), 0);
      g.lineTo(x0 + 400, HEIGHT);
      g.lineTo(x0 + 250, HEIGHT);
      g.closePath();
      g.fill();
    }
    g.restore();

    // step-fret friezes along the top and bottom edges
    paintFrieze(g, 0, false);
    paintFrieze(g, HEIGHT - 13, true);
  }

  function paintFrieze(g, y0, flip) {
    g.fillStyle = "rgba(6, 4, 14, 0.5)";
    g.fillRect(0, y0, WIDTH, 13);
    g.beginPath();
    for (let x = -4; x < WIDTH; x += 22) {
      const b = flip ? y0 + 2 : y0 + 11;
      const d = flip ? 1 : -1;
      g.moveTo(x, b);
      g.lineTo(x, b + (d * 3));
      g.lineTo(x + 3, b + (d * 3));
      g.lineTo(x + 3, b + (d * 6));
      g.lineTo(x + 6, b + (d * 6));
      g.lineTo(x + 6, b + (d * 8.5));
      g.lineTo(x + 13, b + (d * 8.5));
      g.lineTo(x + 13, b + (d * 6));
      g.lineTo(x + 16, b + (d * 6));
      g.lineTo(x + 16, b + (d * 3));
      g.lineTo(x + 19, b + (d * 3));
      g.lineTo(x + 19, b);
    }
    g.lineWidth = 1.3;
    g.lineJoin = "miter";
    g.strokeStyle = "rgba(242, 201, 76, 0.38)";
    g.stroke();
    g.beginPath();
    const edge = flip ? y0 + 0.5 : y0 + 12.5;
    g.moveTo(0, edge);
    g.lineTo(WIDTH, edge);
    g.lineWidth = 1;
    g.strokeStyle = "rgba(242, 201, 76, 0.5)";
    g.stroke();
    g.lineJoin = "round";
  }

  function paintMotif(g, th, rng) {
    g.lineCap = "round";
    g.lineJoin = "round";
    if (th.motif === "sun") {
      for (let i = 0; i < 8; i += 1) {
        const x = 60 + (rng() * 780);
        const y = 40 + (rng() * 470);
        const r = 12 + (rng() * 12);
        engrave(g, (c) => {
          c.beginPath();
          c.arc(x, y, r, 0, TAU);
          c.moveTo(x + (r * 0.5), y);
          c.arc(x, y, r * 0.5, 0, TAU);
          for (let j = 0; j < 12; j += 1) {
            const a = j * TAU / 12;
            c.moveTo(x + (Math.cos(a) * r * 1.18), y + (Math.sin(a) * r * 1.18));
            c.lineTo(x + (Math.cos(a) * r * 1.5), y + (Math.sin(a) * r * 1.5));
          }
        }, 0.28, 0.09, 1.6);
      }
    } else if (th.motif === "glyph") {
      for (let i = 0; i < 10; i += 1) {
        const x = 40 + (rng() * 800);
        const y = 30 + (rng() * 480);
        const s = 22 + (rng() * 10);
        engrave(g, (c) => {
          rr(c, x - (s / 2), y - (s / 2), s, s, 5);
          c.moveTo(x - (s * 0.28), y + (s * 0.22));
          c.lineTo(x - (s * 0.28), y - (s * 0.22));
          c.lineTo(x + (s * 0.1), y - (s * 0.22));
          c.lineTo(x + (s * 0.1), y + (s * 0.05));
          c.moveTo(x + (s * 0.28) + 2, y + (s * 0.22));
          c.arc(x + (s * 0.24), y + (s * 0.2), 2.6, 0, TAU);
        }, 0.3, 0.1, 1.5);
      }
    } else if (th.motif === "jaguar") {
      for (let i = 0; i < 70; i += 1) {
        const x = rng() * WIDTH;
        const y = rng() * HEIGHT;
        const s = 0.8 + (rng() * 0.6);
        g.fillStyle = "rgba(0, 0, 0, 0.16)";
        for (let j = 0; j < 5; j += 1) {
          const a = (j * TAU / 5) + (rng() * 0.5);
          g.beginPath();
          g.ellipse(x + (Math.cos(a) * 5 * s), y + (Math.sin(a) * 5 * s), 2.4 * s, 1.5 * s, a, 0, TAU);
          g.fill();
        }
        g.beginPath();
        g.arc(x, y, 1.4 * s, 0, TAU);
        g.fill();
      }
    } else if (th.motif === "moon") {
      for (let i = 0; i < 7; i += 1) {
        const x = 60 + (rng() * 780);
        const y = 40 + (rng() * 470);
        const r = 10 + (rng() * 9);
        engrave(g, (c) => {
          c.save();
          c.translate(x, y);
          symbolPath(c, "moon", r);
          c.restore();
        }, 0.3, 0.1, 1.5);
      }
      g.fillStyle = "rgba(230, 240, 255, 0.22)";
      for (let i = 0; i < 50; i += 1) g.fillRect(rng() * WIDTH, rng() * HEIGHT, 1.2, 1.2);
    } else {
      for (let i = 0; i < 110; i += 1) {
        const a = 0.1 + (rng() * 0.45);
        const s = 0.6 + (rng() * 1.3);
        g.fillStyle = "rgba(235, 238, 255, " + a.toFixed(2) + ")";
        g.fillRect(rng() * WIDTH, rng() * HEIGHT, s, s);
      }
      g.beginPath();
      let x = 120 + (rng() * 200);
      let y = 60 + (rng() * 120);
      g.moveTo(x, y);
      for (let j = 0; j < 5; j += 1) { x += 30 + (rng() * 40); y += (rng() - 0.4) * 60; g.lineTo(x, y); }
      g.lineWidth = 1;
      g.strokeStyle = "rgba(200, 215, 255, 0.12)";
      g.stroke();
    }
  }

  function paintMedallion(g, th) {
    g.save();
    g.translate(SHOOTER_X, SHOOTER_Y);
    g.beginPath();
    g.arc(1.5, 3.5, 47, 0, TAU);
    g.fillStyle = "rgba(0, 0, 0, 0.3)";
    g.fill();
    const gr = g.createRadialGradient(-14, -16, 4, 0, 0, 46);
    gr.addColorStop(0, hsl(th.hue, th.sat * 0.35, 44));
    gr.addColorStop(1, hsl(th.hue, th.sat * 0.3, 22));
    g.beginPath();
    g.arc(0, 0, 44, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = INK;
    g.stroke();
    for (let i = 0; i < 24; i += 1) {
      const a = i * TAU / 24;
      const r1 = (i % 2) ? 36 : 39;
      g.beginPath();
      g.moveTo(Math.cos(a - 0.06) * 27, Math.sin(a - 0.06) * 27);
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.lineTo(Math.cos(a + 0.06) * 27, Math.sin(a + 0.06) * 27);
      g.closePath();
      g.fillStyle = "rgba(0, 0, 0, 0.24)";
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, 41, 0, TAU);
    g.lineWidth = 1.6;
    g.strokeStyle = "rgba(242, 201, 76, 0.7)";
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 26, 0, TAU);
    g.fillStyle = "rgba(0, 0, 0, 0.22)";
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(242, 201, 76, 0.5)";
    g.stroke();
    g.restore();
  }

  function paintBraziers(g) {
    for (let i = 0; i < BRAZIERS.length; i += 1) {
      const b = BRAZIERS[i];
      let gr = g.createRadialGradient(b.x, b.y, 4, b.x, b.y, 80);
      gr.addColorStop(0, "rgba(255, 170, 70, 0.2)");
      gr.addColorStop(1, "rgba(255, 170, 70, 0)");
      g.fillStyle = gr;
      g.fillRect(b.x - 80, b.y - 80, 160, 160);
      g.beginPath();
      g.ellipse(b.x + 3, b.y + 14, 18, 5, 0, 0, TAU);
      g.fillStyle = "rgba(0, 0, 0, 0.4)";
      g.fill();
      g.beginPath();
      g.moveTo(b.x - 16, b.y - 2);
      g.quadraticCurveTo(b.x - 14, b.y + 13, b.x, b.y + 14);
      g.quadraticCurveTo(b.x + 14, b.y + 13, b.x + 16, b.y - 2);
      g.closePath();
      gr = g.createLinearGradient(0, b.y - 2, 0, b.y + 14);
      gr.addColorStop(0, "#7a6a58");
      gr.addColorStop(1, "#2a2030");
      g.fillStyle = gr;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.moveTo(b.x - 14.5, b.y + 3.5);
      g.quadraticCurveTo(b.x, b.y + 9.5, b.x + 14.5, b.y + 3.5);
      g.lineWidth = 2;
      g.strokeStyle = "#e0b24a";
      g.stroke();
      g.beginPath();
      g.ellipse(b.x, b.y - 2, 16.5, 5, 0, 0, TAU);
      g.fillStyle = "#d9a93a";
      g.fill();
      g.lineWidth = 1.8;
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.ellipse(b.x, b.y - 2, 13, 3.4, 0, 0, TAU);
      gr = g.createRadialGradient(b.x, b.y - 2, 1, b.x, b.y - 2, 13);
      gr.addColorStop(0, "#ffe08a");
      gr.addColorStop(0.5, "#ff6a2a");
      gr.addColorStop(1, "#4a160c");
      g.fillStyle = gr;
      g.fill();
    }
  }

  function paintTrack(g) {
    const total = path.total;
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    // soft drop shadow
    tracePath(g);
    g.shadowColor = "rgba(0, 0, 0, 0.6)";
    g.shadowBlur = 12 * scaleX;
    g.shadowOffsetY = 5 * scaleY;
    g.lineWidth = 41;
    g.strokeStyle = "rgba(0, 0, 0, 0.5)";
    g.stroke();
    g.shadowColor = "rgba(0, 0, 0, 0)";
    g.shadowBlur = 0;
    g.shadowOffsetY = 0;
    // ink outline + bevelled gold rim
    tracePath(g);
    g.lineWidth = 40;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 36;
    g.strokeStyle = "#946a1f";
    g.stroke();
    g.save();
    g.translate(-0.8, -1.4);
    tracePath(g);
    g.lineWidth = 33;
    g.strokeStyle = "#ffe9a6";
    g.stroke();
    g.restore();
    const gold = g.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gold.addColorStop(0, "#f3d27a");
    gold.addColorStop(0.5, "#d4aa4c");
    gold.addColorStop(1, "#b0832e");
    tracePath(g);
    g.lineWidth = 32.5;
    g.strokeStyle = gold;
    g.stroke();
    // carved block joints across the rim
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(92, 60, 12, 0.6)";
    g.beginPath();
    for (let d = 18; d < total - 4; d += 34) {
      samplePath(d);
      if (SEG_IN < 16) continue;
      const nx = -UY;
      const ny = UX;
      g.moveTo(PX + (nx * 8.5), PY + (ny * 8.5));
      g.lineTo(PX + (nx * 16.5), PY + (ny * 16.5));
      g.moveTo(PX - (nx * 8.5), PY - (ny * 8.5));
      g.lineTo(PX - (nx * 16.5), PY - (ny * 16.5));
    }
    g.stroke();
    // groove the marbles roll in
    tracePath(g);
    g.lineWidth = 16.5;
    g.strokeStyle = "#5a3c10";
    g.stroke();
    g.lineWidth = 14;
    g.strokeStyle = "#0b161c";
    g.stroke();
    g.save();
    g.translate(0, 1.3);
    tracePath(g);
    g.lineWidth = 9;
    g.strokeStyle = "rgba(42, 74, 78, 0.55)";
    g.stroke();
    g.restore();
    // danger zone: the last stretch glows red toward the pit
    const bands = [[0.84, 0.07], [0.91, 0.09], [0.96, 0.13]];
    for (let i = 0; i < bands.length; i += 1) {
      traceSub(g, total * bands[i][0], total);
      g.lineWidth = 32;
      g.strokeStyle = "rgba(255, 46, 72, " + bands[i][1] + ")";
      g.stroke();
    }
    // engraved direction chevrons
    g.beginPath();
    for (let d = 46; d < total - 40; d += 70) {
      samplePath(d);
      if (SEG_IN < 15) continue;
      const nx = -UY;
      const ny = UX;
      g.moveTo(PX - (UX * 2.2) + (nx * 3.4), PY - (UY * 2.2) + (ny * 3.4));
      g.lineTo(PX + (UX * 1.8), PY + (UY * 1.8));
      g.lineTo(PX - (UX * 2.2) - (nx * 3.4), PY - (UY * 2.2) - (ny * 3.4));
    }
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(232, 196, 110, 0.42)";
    g.stroke();
    g.restore();
  }

  function paintPortal(g) {
    const p = path.points[0];
    g.save();
    g.translate(p.x, p.y);
    g.beginPath();
    g.arc(1.5, 4, 27, 0, TAU);
    g.fillStyle = "rgba(0, 0, 0, 0.35)";
    g.fill();
    let gr = g.createRadialGradient(-8, -9, 2, 0, 0, 27);
    gr.addColorStop(0, "#9aa6a0");
    gr.addColorStop(1, "#3d4a4c");
    g.beginPath();
    g.arc(0, 0, 26, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2.4;
    g.strokeStyle = INK;
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = (i * TAU / 8) + 0.2;
      g.moveTo(Math.cos(a) * 20.5, Math.sin(a) * 20.5);
      g.lineTo(Math.cos(a) * 25.5, Math.sin(a) * 25.5);
    }
    g.lineWidth = 1.3;
    g.strokeStyle = "rgba(20, 14, 30, 0.55)";
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 19.5, 0, TAU);
    g.lineWidth = 4.6;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 2.8;
    g.strokeStyle = "#e7bf55";
    g.stroke();
    gr = g.createRadialGradient(0, 0, 0, 0, 0, 17);
    gr.addColorStop(0, "#000000");
    gr.addColorStop(0.6, "#031417");
    gr.addColorStop(1, "#0f4744");
    g.beginPath();
    g.arc(0, 0, 17, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.beginPath();
    g.arc(0, 0, 16.4, 0, TAU);
    g.lineWidth = 1.2;
    g.strokeStyle = "rgba(44, 198, 180, 0.55)";
    g.stroke();
    g.restore();
  }

  function paintPit(g) {
    const p = path.points[path.points.length - 1];
    g.save();
    g.translate(p.x, p.y);
    g.beginPath();
    g.arc(1.5, 4, 30, 0, TAU);
    g.fillStyle = "rgba(0, 0, 0, 0.4)";
    g.fill();
    g.beginPath();
    for (let i = 0; i < 32; i += 1) {
      const a = i * TAU / 32;
      const r = (i % 2) ? 25.5 : 29;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    let gr = g.createRadialGradient(-8, -10, 2, 0, 0, 30);
    gr.addColorStop(0, "#6a5a70");
    gr.addColorStop(1, "#241a30");
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2.2;
    g.lineJoin = "round";
    g.strokeStyle = INK;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 23.4, 0, TAU);
    g.lineWidth = 2;
    g.strokeStyle = "#c9a24a";
    g.stroke();
    gr = g.createRadialGradient(0, 0, 0, 0, 0, 22);
    gr.addColorStop(0, "#000000");
    gr.addColorStop(0.55, "#12040a");
    gr.addColorStop(1, "#4a0c18");
    g.beginPath();
    g.arc(0, 0, 22, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.beginPath();
    g.arc(0, 0, 21, 0, TAU);
    g.lineWidth = 1.4;
    g.strokeStyle = "rgba(255, 74, 94, 0.4)";
    g.stroke();
    g.restore();
  }

  function paintPlaque(g) {
    const kicker = "TEMPLE " + String(levelIndex + 1) + " / " + String(LEVELS.length);
    const title = currentLevel().name;
    g.save();
    g.font = "700 14px Unbounded, Outfit, sans-serif";
    const tw = g.measureText(title).width;
    g.font = "600 9px 'JetBrains Mono', monospace";
    const kw = g.measureText(kicker).width;
    const x = 12;
    const y = 14;
    const w = Math.max(tw, kw) + 60;
    const h = 40;
    rr(g, x + 1, y + 3, w, h, 11);
    g.fillStyle = "rgba(0, 0, 0, 0.35)";
    g.fill();
    rr(g, x, y, w, h, 11);
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "rgba(30, 22, 54, 0.9)");
    gr.addColorStop(1, "rgba(10, 8, 24, 0.9)");
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = INK;
    g.stroke();
    rr(g, x + 2.5, y + 2.5, w - 5, h - 5, 9);
    g.lineWidth = 1;
    g.strokeStyle = "rgba(242, 201, 76, 0.45)";
    g.stroke();
    // gold level coin
    const cx = x + 21;
    const cy = y + (h / 2);
    const cg = g.createRadialGradient(cx - 4, cy - 5, 1, cx, cy, 14);
    cg.addColorStop(0, "#fff4c4");
    cg.addColorStop(0.5, "#f2c94c");
    cg.addColorStop(1, "#a87a22");
    g.beginPath();
    g.arc(cx, cy, 13, 0, TAU);
    g.fillStyle = cg;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = INK;
    g.font = "800 12px Unbounded, Outfit, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(levelIndex + 1), cx, cy + 0.5);
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "rgba(242, 201, 76, 0.92)";
    g.font = "600 9px 'JetBrains Mono', monospace";
    g.fillText(kicker, x + 42, y + 16);
    g.fillStyle = "#f5f0ff";
    g.font = "700 14px Unbounded, Outfit, sans-serif";
    g.fillText(title, x + 42, y + 32);
    g.restore();
  }

  function buildLayer() {
    if (!layer) layer = document.createElement("canvas");
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      layer.width = canvas.width;
      layer.height = canvas.height;
    }
    theme = THEMES[levelIndex % THEMES.length];
    const g = layer.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, layer.width, layer.height);
    g.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    const rng = mulberry32(1013 + (levelIndex * 7919));
    paintFloor(g, theme, rng);
    paintMedallion(g, theme);
    paintBraziers(g);
    paintTrack(g);
    paintPortal(g);
    paintPit(g);
    // vignette
    const vg = g.createRadialGradient(450, 280, 250, 450, 280, 600);
    vg.addColorStop(0, "rgba(2, 6, 10, 0)");
    vg.addColorStop(1, "rgba(2, 6, 10, 0.55)");
    g.fillStyle = vg;
    g.fillRect(0, 0, WIDTH, HEIGHT);
    if (cssW >= 520) paintPlaque(g);
    // progress bar geometry + accent gradient (theme-aware)
    const u = uiScale;
    progGeom.w = 250 * u;
    progGeom.h = 7 * u;
    progGeom.x = 450 - (progGeom.w / 2);
    progGeom.y = 531 - (progGeom.h / 2);
    progGrad = ctx.createLinearGradient(progGeom.x, 0, progGeom.x + progGeom.w, 0);
    progGrad.addColorStop(0, accent);
    progGrad.addColorStop(1, accentLight);
    // mote sprite for this temple
    if (spr) spr.mote = makeGlow(scaleX, 16, theme.mote);
    layerDirty = false;
  }

  /* ---------- effects ---------- */
  function addPart(kind, x, y, vx, vy, life, size, ci) {
    if (pCount >= P_MAX) return;
    const p = parts[pCount];
    pCount += 1;
    p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.max = life; p.size = size; p.ci = ci;
    p.rot = Math.random() * TAU;
    p.vr = (Math.random() - 0.5) * 16;
  }

  function addPop(x, y, ci) {
    if (popCount >= POP_MAX) return;
    const p = pops[popCount];
    popCount += 1;
    p.x = x; p.y = y; p.ci = ci; p.t0 = frameNow;
  }

  function addText(x, y, text, size, fill, dur, rise) {
    if (txtCount >= TXT_MAX) return;
    const t = txts[txtCount];
    txtCount += 1;
    t.x = clamp(x, 60, WIDTH - 60);
    t.y = clamp(y, 40, HEIGHT - 40);
    t.text = text;
    t.font = "800 " + Math.round(size * uiScale) + "px Unbounded, Outfit, sans-serif";
    t.fill = fill;
    t.dur = dur;
    t.rise = rise * uiScale;
    t.t0 = frameNow;
  }

  function resetFx() {
    pCount = 0;
    popCount = 0;
    txtCount = 0;
    chainLbl.t0 = -1e9;
    danger = 0;
    lossT = -1e9;
    clearT = -1e9;
    clearBurstDone = true;
    shakeT = -1e9;
    layerDirty = true;
  }

  function fxMatch(removed, amount, combo) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < removed.length; i += 1) {
      samplePath(removed[i].offset);
      sx += PX;
      sy += PY;
    }
    sx /= removed.length;
    sy /= removed.length;
    const now = frameNow;
    matchStack = (now - lastMatchFxT < 60) ? matchStack + 1 : 0;
    lastMatchFxT = now;
    const u = uiScale;
    // readouts float above the match, or below it when the match is near the top edge
    const below = sy < 150;
    const lift = matchStack * 19 * u;
    const scoreY = below ? sy + (24 * u) + lift : sy - 4 - lift;
    addText(sx, scoreY, "+" + String(amount), combo > 1 ? 17 : 15, combo > 1 ? "#ffd76a" : "#fff6dc", 950, below ? 14 : 34);
    if (combo >= 2) {
      // one chain label per shot: a longer chain just upgrades it
      const labelY = clamp(below ? scoreY + (26 * u) : scoreY - (28 * u), 46, HEIGHT - 46);
      if (now - chainLbl.t0 > 400) {
        chainLbl.x = clamp(sx, 90, WIDTH - 90);
        chainLbl.y = labelY;
      } else {
        chainLbl.y = below ? Math.max(chainLbl.y, labelY) : Math.min(chainLbl.y, labelY);
      }
      chainLbl.t0 = now;
      chainLbl.text = "CHAIN \u00d7" + String(combo);
      chainLbl.font = "800 " + Math.round(19 * uiScale) + "px Unbounded, Outfit, sans-serif";
      chainLbl.rise = (below ? 10 : 26) * u;
      if (combo >= 3) {
        shakeT = frameNow;
        shakeAmp = 2.2;
      }
    }
  }

  function fxShoot() {
    shootT = frameNow;
  }

  function fxSwap() {
    swapT = frameNow;
  }

  function onStateFx(prev, next) {
    const now = frameNow;
    if (next === "running" && prev !== "paused" && prev !== "running") {
      banner.t0 = now;
      banner.kicker = "TEMPLE " + String(levelIndex + 1) + " OF " + String(LEVELS.length);
      banner.title = currentLevel().name;
    }
    if (next === "lost" && prev === "running") {
      lossT = now;
      shakeT = now;
      shakeAmp = 4;
      const pe = path.points[path.points.length - 1];
      if (!reducedMotion) {
        for (let i = 0; i < 26; i += 1) {
          const a = Math.random() * TAU;
          const sp = 60 + (Math.random() * 170);
          addPart(i % 3 ? KIND_SPARK : KIND_SHARD, pe.x, pe.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + (Math.random() * 0.5), 3 + (Math.random() * 6), i % 2 ? CI_RED : CI_FIRE);
        }
      }
    }
    if ((next === "cleared" || next === "complete") && prev === "running") {
      clearT = now;
      clearBurstDone = false;
    }
  }

  function updateFx(dt) {
    const drag = Math.exp(-dt * 2.6);
    for (let i = 0; i < pCount;) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        pCount -= 1;
        parts[i] = parts[pCount];
        parts[pCount] = p;
        continue;
      }
      if (p.kind !== KIND_RING) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= drag;
        p.vy *= drag;
        if (p.kind === KIND_SHARD) p.vy += 260 * dt;
        p.rot += p.vr * dt;
      }
      i += 1;
    }
    // chain push/insert easing
    const k = reducedMotion ? 0 : Math.exp(-dt * 16);
    for (let i = 0; i < chain.length; i += 1) {
      const m = chain[i];
      if (m.vd) {
        m.vd *= k;
        if (Math.abs(m.vd) < 0.05) m.vd = 0;
      }
    }
    // danger level (front marble vs. the pit)
    let target = 0;
    if (gameState === "lost") target = 1;
    else if ((gameState === "running" || gameState === "paused") && chain.length) {
      target = clamp(((chain[chain.length - 1].offset / path.total) - 0.7) / 0.26, 0, 1);
    }
    danger += (target - danger) * Math.min(1, dt * 4);
    // clear sweep sparks + final burst
    const now = frameNow;
    const ce = (now - clearT) / 1400;
    if (!reducedMotion && ce >= 0 && ce < 1) {
      samplePath(path.total * easeInOut(ce));
      const a = Math.random() * TAU;
      addPart(KIND_SPARK, PX, PY, Math.cos(a) * 60, Math.sin(a) * 60 - 30, 0.5, 4 + (Math.random() * 4), CI_GOLD);
    }
    if (!clearBurstDone && (ce >= 1 || (reducedMotion && ce >= 0))) {
      clearBurstDone = true;
      const pe = path.points[path.points.length - 1];
      if (!reducedMotion) {
        for (let i = 0; i < 30; i += 1) {
          const a = Math.random() * TAU;
          const sp = 80 + (Math.random() * 200);
          addPart(i % 4 ? KIND_SPARK : KIND_SHARD, pe.x, pe.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + (Math.random() * 0.6), 4 + (Math.random() * 6), i % 3 ? CI_GOLD : CI_WHITE);
        }
      }
      addPart(KIND_RING, pe.x, pe.y, 0, 0, 0.6, 20, CI_GOLD);
    }
  }

  /* ---------- per-frame drawing ---------- */
  function drawSprite(img, x, y, size) {
    ctx.drawImage(img, x - (size / 2), y - (size / 2), size, size);
  }

  function drawFlame(x, y, f, t) {
    const h = 15 * f;
    const w = 6.5;
    const sway = reducedMotion ? 0 : Math.sin((t * 0.009) + x) * 1.6;
    ctx.fillStyle = "#ff7a2a";
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x - (w * 0.9), y - (h * 0.55), x + sway, y - h);
    ctx.quadraticCurveTo(x + (w * 0.9), y - (h * 0.55), x + w, y);
    ctx.quadraticCurveTo(x, y + 3, x - w, y);
    ctx.fill();
    ctx.fillStyle = "#ffc94a";
    ctx.beginPath();
    ctx.moveTo(x - (w * 0.6), y);
    ctx.quadraticCurveTo(x - (w * 0.5), y - (h * 0.4), x + (sway * 0.7), y - (h * 0.72));
    ctx.quadraticCurveTo(x + (w * 0.5), y - (h * 0.4), x + (w * 0.6), y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff3c4";
    ctx.beginPath();
    ctx.ellipse(x, y - (h * 0.18), w * 0.28, h * 0.2, 0, 0, TAU);
    ctx.fill();
  }

  function drawAmbient(now) {
    const t = reducedMotion ? 0 : now;
    const glows = spr.glows;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < BRAZIERS.length; i += 1) {
      const b = BRAZIERS[i];
      const f = reducedMotion ? 0.85 : 0.8 + (0.12 * Math.sin((t * 0.013) + b.ph)) + (0.08 * Math.sin((t * 0.031) + (b.ph * 2)));
      ctx.globalAlpha = 0.32 * f;
      drawSprite(glows[CI_FIRE], b.x, b.y - 8, 120);
    }
    if (spr.mote) {
      for (let i = 0; i < motes.length; i += 1) {
        const m = motes[i];
        const x = m.x + (Math.sin((t * 0.0004) + m.ph) * 14);
        let y = (m.y - (t * m.sp * 0.001)) % HEIGHT;
        if (y < 0) y += HEIGHT;
        const tw = Math.sin((t * 0.0018) + m.ph);
        ctx.globalAlpha = 0.16 + (0.22 * tw * tw);
        drawSprite(spr.mote, x, y, m.s * 2.2);
      }
    }
    const p0 = path.points[0];
    ctx.globalAlpha = 0.42 + (0.14 * Math.sin(t * 0.004));
    drawSprite(glows[CI_TEAL], p0.x, p0.y, 54);
    const pe = path.points[path.points.length - 1];
    const pulse = reducedMotion ? 1 : 0.7 + (0.3 * Math.sin(t * (0.005 + (danger * 0.012))));
    ctx.globalAlpha = 0.14 + (danger * 0.6 * pulse);
    drawSprite(glows[CI_RED], pe.x, pe.y, 84 + (danger * 30));
    ctx.restore();

    for (let i = 0; i < BRAZIERS.length; i += 1) {
      const b = BRAZIERS[i];
      const f = reducedMotion ? 0.9 : 0.86 + (0.1 * Math.sin((t * 0.017) + b.ph)) + (0.06 * Math.sin((t * 0.043) + b.ph));
      drawFlame(b.x, b.y - 3, f, t);
    }

    // swirl inside the start portal
    ctx.save();
    ctx.translate(p0.x, p0.y);
    ctx.rotate(t * 0.0018);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(120, 255, 235, 0.5)";
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, 7 + (i * 2.8), i * 2.1, (i * 2.1) + 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawChain(now) {
    const n = chain.length;
    if (!n) return;
    if (bufX.length < n) {
      const cap = Math.max(n, bufX.length * 2);
      bufX = new Float32Array(cap);
      bufY = new Float32Array(cap);
      bufS = new Float32Array(cap);
    }
    for (let i = 0; i < n; i += 1) {
      const m = chain[i];
      samplePath(m.offset - (m.vd || 0));
      let x = PX;
      let y = PY;
      if (m.vIt) {
        const e = Math.max(0, (now - m.vIt) / 140);
        if (e < 1 && !reducedMotion) {
          const q = easeOutCubic(e);
          x = m.vIx + ((x - m.vIx) * q);
          y = m.vIy + ((y - m.vIy) * q);
        } else {
          m.vIt = 0;
        }
      }
      let s = 1;
      if (m.vBorn) {
        const e = Math.max(0, (now - m.vBorn) / 240);
        if (e < 1 && !reducedMotion) s = 0.2 + (0.8 * easeOutBack(e));
        else m.vBorn = 0;
      }
      if (m.vCi === undefined) m.vCi = styleIndex(m.color);
      bufX[i] = x;
      bufY[i] = y;
      bufS[i] = s;
    }
    const shSize = 34;
    for (let i = 0; i < n; i += 1) {
      drawSprite(spr.shadow, bufX[i] + 2, bufY[i] + 3.5, shSize * bufS[i]);
    }
    const ms = spr.mSize;
    for (let i = 0; i < n; i += 1) {
      drawSprite(spr.marbles[chain[i].vCi], bufX[i], bufY[i], ms * bufS[i]);
    }
    if (gameState === "lost") {
      const le = now - lossT;
      const front = (le / 1000) * 700;
      ctx.fillStyle = "#0a0414";
      for (let i = 0; i < n; i += 1) {
        let a;
        if (reducedMotion) a = clamp(le / 500, 0, 1) * 0.5;
        else a = clamp((front - (path.total - chain[i].offset)) / 140, 0, 1) * 0.55;
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(bufX[i], bufY[i], BALL_RADIUS + 0.5, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPops(now) {
    for (let i = 0; i < popCount;) {
      const p = pops[i];
      const e = (now - p.t0) / 240;
      if (e >= 1) {
        popCount -= 1;
        pops[i] = pops[popCount];
        pops[popCount] = p;
        continue;
      }
      const q = 1 - e;
      ctx.globalAlpha = q * q;
      drawSprite(spr.marbles[p.ci], p.x, p.y, spr.mSize * (1 + (reducedMotion ? 0 : 0.6 * e)));
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = q * 0.8;
      drawSprite(spr.glows[CI_WHITE], p.x, p.y, 34 + (e * 26));
      ctx.globalCompositeOperation = "source-over";
      i += 1;
    }
    ctx.globalAlpha = 1;
  }

  function drawSkull(now) {
    const pe = path.points[path.points.length - 1];
    const sx = pe.x;
    const sy = pe.y - 1;
    drawSprite(spr.skull, sx, sy, spr.sSize);
    let glow = 0.3 + (danger * 0.7);
    if (gameState === "cleared" || gameState === "complete") glow = 0.05;
    if (!reducedMotion) glow *= 0.8 + (0.2 * Math.sin(now * (0.004 + (danger * 0.014))));
    const le = (now - lossT) / 900;
    if (le >= 0 && le < 1) glow += (1 - le) * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let s = -1; s <= 1; s += 2) {
      const ex = sx + (s * 5.6);
      const ey = sy - 2.1;
      ctx.globalAlpha = clamp(glow, 0, 1);
      drawSprite(spr.glows[CI_RED], ex, ey, 10 + (glow * 12));
      ctx.globalAlpha = clamp(glow * 1.2, 0, 1);
      drawSprite(spr.glows[CI_WHITE], ex, ey, 4 + (glow * 2));
    }
    ctx.restore();
  }

  function drawShots() {
    if (!shots.length) return;
    const ms = spr.mSize * 0.9;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i];
      const ci = styleIndex(s.color);
      for (let j = 1; j <= 4; j += 1) {
        ctx.globalAlpha = 0.34 * (1 - (j / 5));
        drawSprite(spr.glows[ci], s.x - (s.vx * 0.011 * j), s.y - (s.vy * 0.011 * j), 26 - (j * 3));
      }
    }
    ctx.restore();
    for (let i = 0; i < shots.length; i += 1) {
      const s = shots[i];
      drawSprite(spr.shadow, s.x + 2, s.y + 3.5, 30);
      drawSprite(spr.marbles[styleIndex(s.color)], s.x, s.y, ms);
    }
  }

  function drawAim(now) {
    if (gameState !== "running" && gameState !== "ready" && gameState !== "paused") return;
    const fx = Math.cos(aimAngle);
    const fy = Math.sin(aimAngle);
    const ci = currentColor ? styleIndex(currentColor) : CI_GOLD;
    const phase = (reducedMotion || gameState !== "running") ? 0 : (now * 0.028) % 16;
    for (let i = 0; i < 12; i += 1) {
      const d = 58 + (i * 16) + phase;
      const a = 1 - ((d - 58) / 196);
      if (a <= 0) continue;
      const x = SHOOTER_X + (fx * d);
      const y = SHOOTER_Y + (fy * d);
      if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) break;
      const r = 2.7 - (i * 0.1);
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = "#0a0614";
      ctx.beginPath();
      ctx.arc(x, y + 0.5, r + 1.1, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = FX_LIGHT[ci];
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShooter(now) {
    const fx = Math.cos(aimAngle);
    const fy = Math.sin(aimAngle);
    const se = (now - shootT) / 140;
    const recoil = (reducedMotion || se < 0 || se >= 1) ? 0 : (1 - se) * 3;
    const bx = SHOOTER_X - (fx * recoil);
    const by = SHOOTER_Y - (fy * recoil);
    drawSprite(spr.turretShadow, bx + 3, by + 6, 84);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(aimAngle + (Math.PI / 2));
    ctx.drawImage(spr.turret, -spr.tSize / 2, -spr.tSize / 2, spr.tSize, spr.tSize);
    ctx.restore();

    const ci = currentColor ? styleIndex(currentColor) : CI_GOLD;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let s = -1; s <= 1; s += 2) {
      const a = aimAngle + (s * 0.95);
      const ex = bx + (Math.cos(a) * 19.4);
      const ey = by + (Math.sin(a) * 19.4);
      ctx.globalAlpha = 0.95;
      drawSprite(spr.glows[ci], ex, ey, 11);
    }
    ctx.restore();

    // current marble at the muzzle, next marble in the obsidian core
    const mx = bx + (fx * 38);
    const my = by + (fy * 38);
    let curX = mx;
    let curY = my;
    let curS = 1;
    let nxtX = bx;
    let nxtY = by;
    let nxtS = 0.78;
    const sw = (now - swapT) / 180;
    if (!reducedMotion && sw >= 0 && sw < 1) {
      const q = easeInOut(sw);
      const bulge = Math.sin(Math.PI * q) * 12;
      const px = -fy;
      const py = fx;
      curX = bx + ((mx - bx) * q) + (px * bulge);
      curY = by + ((my - by) * q) + (py * bulge);
      curS = 0.78 + (0.22 * q);
      nxtX = mx + ((bx - mx) * q) - (px * bulge);
      nxtY = my + ((by - my) * q) - (py * bulge);
      nxtS = 1 - (0.22 * q);
    }
    const sh = (now - shootT) / 150;
    if (!reducedMotion && sh >= 0 && sh < 1) {
      const q = easeOutCubic(sh);
      curX = bx + ((mx - bx) * q);
      curY = by + ((my - by) * q);
      curS = 0.78 + (0.22 * q);
      nxtX = bx;
      nxtY = by;
      nxtS = 0.78 * q;
    }
    if (nextColor && nxtS > 0.03) {
      drawSprite(spr.marbles[styleIndex(nextColor)], nxtX, nxtY, spr.mSize * nxtS);
    }
    if (currentColor) {
      drawSprite(spr.shadow, curX + 1.5, curY + 3, 30 * curS);
      drawSprite(spr.marbles[ci], curX, curY, spr.mSize * curS);
    }
    const fe = (now - shootT) / 130;
    if (fe >= 0 && fe < 1) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1 - fe;
      drawSprite(spr.glows[CI_WHITE], bx + (fx * 46), by + (fy * 46), 44 * (1 - (fe * 0.4)));
      ctx.restore();
    }
  }

  function drawParticles() {
    if (!pCount) return;
    for (let i = 0; i < pCount; i += 1) {
      const p = parts[i];
      const a = p.life / p.max;
      if (p.kind === KIND_SHARD) {
        const c = Math.cos(p.rot) * p.size;
        const s = Math.sin(p.rot) * p.size;
        ctx.globalAlpha = Math.min(1, a * 1.4);
        ctx.fillStyle = FX_BASE[p.ci];
        ctx.beginPath();
        ctx.moveTo(p.x + c, p.y + s);
        ctx.lineTo(p.x - (c * 0.6) - (s * 0.7), p.y - (s * 0.6) + (c * 0.7));
        ctx.lineTo(p.x - (c * 0.5) + (s * 0.6), p.y - (s * 0.5) - (c * 0.6));
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === KIND_RING) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = FX_LIGHT[p.ci];
        ctx.lineWidth = 3 * a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + ((1 - a) * p.size * 1.6), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < pCount; i += 1) {
      const p = parts[i];
      if (p.kind !== KIND_SPARK) continue;
      const a = p.life / p.max;
      ctx.globalAlpha = a;
      drawSprite(spr.glows[p.ci], p.x, p.y, p.size * (1.2 + a));
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  function drawFloat(t, now) {
    const e = Math.max(0, (now - t.t0) / t.dur);
    if (e >= 1) return false;
    const alpha = e < 0.12 ? e / 0.12 : (e > 0.6 ? (1 - e) / 0.4 : 1);
    const sc = (reducedMotion || e >= 0.16) ? 1 : 1.35 - (0.35 * (e / 0.16));
    const y = t.y - (reducedMotion ? 0 : t.rise * easeOutCubic(e));
    ctx.globalAlpha = alpha;
    ctx.font = t.font;
    ctx.setTransform(scaleX * sc, 0, 0, scaleY * sc, t.x * scaleX, y * scaleY);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(20, 10, 36, 0.92)";
    ctx.strokeText(t.text, 0, 0);
    ctx.fillStyle = t.fill;
    ctx.fillText(t.text, 0, 0);
    return true;
  }

  function drawTexts(now) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (let i = 0; i < txtCount;) {
      const t = txts[i];
      if (!drawFloat(t, now)) {
        txtCount -= 1;
        txts[i] = txts[txtCount];
        txts[txtCount] = t;
        continue;
      }
      i += 1;
    }
    drawFloat(chainLbl, now);
    ctx.restore();

    // level banner
    const be = (now - banner.t0) / 1900;
    if (be >= 0 && be < 1 && gameState === "running") {
      const alpha = be < 0.12 ? be / 0.12 : (be > 0.72 ? (1 - be) / 0.28 : 1);
      const u = uiScale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "800 " + Math.round(24 * u) + "px Unbounded, Outfit, sans-serif";
      const tw = ctx.measureText(banner.title).width;
      const w = tw + (64 * u);
      const h = 64 * u;
      const cx = 450;
      const cy = 214 - (reducedMotion ? 0 : (1 - easeOutCubic(Math.min(1, be / 0.14))) * 10);
      rr(ctx, cx - (w / 2), cy - (h / 2), w, h, 14 * u);
      ctx.fillStyle = "rgba(10, 8, 24, 0.82)";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      rr(ctx, cx - (w / 2) + 3, cy - (h / 2) + 3, w - 6, h - 6, 11 * u);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(242, 201, 76, 0.6)";
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#f2c94c";
      ctx.font = "600 " + Math.round(10 * u) + "px 'JetBrains Mono', monospace";
      ctx.fillText(banner.kicker, cx, cy - (14 * u));
      ctx.font = "800 " + Math.round(24 * u) + "px Unbounded, Outfit, sans-serif";
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.strokeText(banner.title, cx, cy + (9 * u));
      ctx.fillStyle = "#fff4d6";
      ctx.fillText(banner.title, cx, cy + (9 * u));
      ctx.restore();
    }
  }

  function drawScreenFx(now) {
    if (danger > 0.01 && gameState === "running") {
      ctx.globalAlpha = danger * 0.5 * (reducedMotion ? 1 : 0.72 + (0.28 * Math.sin(now * 0.009)));
      ctx.drawImage(spr.redVig, 0, 0, WIDTH, HEIGHT);
    }
    const pe = path.points[path.points.length - 1];
    const le = (now - lossT) / 900;
    if (le >= 0 && le < 1) {
      ctx.globalAlpha = (1 - le) * 0.75;
      ctx.drawImage(spr.redVig, 0, 0, WIDTH, HEIGHT);
      if (!reducedMotion) {
        for (let r = 0; r < 3; r += 1) {
          const e = (now - lossT - (r * 130)) / 650;
          if (e < 0 || e >= 1) continue;
          ctx.globalAlpha = (1 - e) * 0.85;
          ctx.strokeStyle = "#ff5a6e";
          ctx.lineWidth = 6 * (1 - e);
          ctx.beginPath();
          ctx.arc(pe.x, pe.y, 22 + (e * 190), 0, TAU);
          ctx.stroke();
        }
      }
    }
    const ce = (now - clearT) / 1400;
    if (ce >= 0 && ce < 1.4) {
      ctx.globalAlpha = Math.max(0, 1 - (ce / 1.4)) * 0.45;
      ctx.drawImage(spr.goldVig, 0, 0, WIDTH, HEIGHT);
      if (!reducedMotion && ce < 1) {
        const d = path.total * easeInOut(ce);
        ctx.globalCompositeOperation = "lighter";
        for (let i = 6; i >= 0; i -= 1) {
          samplePath(Math.max(0, d - (i * 24)));
          ctx.globalAlpha = (1 - (i / 7)) * 0.9;
          drawSprite(spr.glows[i === 0 ? CI_WHITE : CI_GOLD], PX, PY, 70 - (i * 7));
        }
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawMeta() {
    const level = currentLevel();
    const progress = clamp(1 - (getRemainingCount() / level.marbles), 0, 1);
    const g = progGeom;
    rr(ctx, g.x - 2.5, g.y - 2.5, g.w + 5, g.h + 5, (g.h + 5) / 2);
    ctx.fillStyle = "rgba(6, 4, 14, 0.82)";
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "rgba(242, 201, 76, 0.55)";
    ctx.stroke();
    if (progress > 0) {
      const w = Math.max(g.h, g.w * progress);
      rr(ctx, g.x, g.y, w, g.h, g.h / 2);
      ctx.fillStyle = progGrad || accent;
      ctx.fill();
      rr(ctx, g.x + 1, g.y + 0.8, Math.max(0, w - 2), g.h * 0.42, g.h * 0.21);
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.fill();
    }
  }

  function render(now) {
    if (!spr || spr.k !== scaleX) buildSprites();
    if (layerDirty || !layer) buildLayer();
    if (!spr.mote) spr.mote = makeGlow(scaleX, 16, theme.mote);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let ox = 0;
    let oy = 0;
    const se = (now - shakeT) / 420;
    if (!reducedMotion && se >= 0 && se < 1) {
      const a = shakeAmp * (1 - se) * (1 - se);
      ox = Math.sin(now * 0.11) * a;
      oy = Math.cos(now * 0.137) * a;
      ctx.fillStyle = "#04141a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.setTransform(scaleX, 0, 0, scaleY, ox * scaleX, oy * scaleY);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(layer, 0, 0, WIDTH, HEIGHT);
    drawAmbient(now);
    drawChain(now);
    drawPops(now);
    drawSkull(now);
    drawShots();
    drawAim(now);
    drawShooter(now);
    drawParticles();
    drawTexts(now);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    drawScreenFx(now);
    drawMeta();
    updateHud();
  }

  function gameLoop(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.035);
    lastFrameTime = now;
    frameNow = now;

    updateFx(dt);
    updateGame(dt);
    render(now);
    window.requestAnimationFrame(gameLoop);
  }

  function handleKeyDown(event) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      shootBall();
      return;
    }

    if (event.key === "p" || event.key === "P") {
      if (gameState === "running") {
        pauseGame();
      } else if (gameState === "paused") {
        setGameState("running");
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      aimAngle -= 0.12;
      return;
    }

    if (event.key === "ArrowRight") {
      aimAngle += 0.12;
      return;
    }

    if (event.key === "x" || event.key === "X" || event.key === "Shift") {
      swapShooterColors();
      return;
    }

    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      toggleFullscreen();
    }
  }

  canvas.addEventListener("pointermove", (event) => {
    updateAimFromClient(event.clientX, event.clientY);
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.focus();
    updateAimFromClient(event.clientX, event.clientY);
    shootBall();
  }, { passive: false });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    swapShooterColors();
  });

  startBtn.addEventListener("click", () => {
    startOrAdvance();
  });

  pauseBtn.addEventListener("click", () => {
    pauseGame();
  });

  restartBtn.addEventListener("click", () => {
    restartRun();
  });

  fsBtn.addEventListener("click", () => {
    toggleFullscreen();
  });

  landscapeBtn.addEventListener("click", () => {
    requestFullscreenLandscape();
  });

  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    updateLandscapeTip();
  });

  window.addEventListener("resize", updateLandscapeTip);
  window.addEventListener("orientationchange", updateLandscapeTip);

  document.addEventListener("keydown", handleKeyDown);

  // DPR-aware backing store + theme accent
  function onThemeChanged() {
    readAccent();
    layerDirty = true;
  }
  document.addEventListener("cartofia:theme-changed", onThemeChanged);
  window.addEventListener("cartofia:theme-changed", onThemeChanged);
  if (window.ResizeObserver) {
    new ResizeObserver(() => { syncCanvasSize(); }).observe(canvas);
  }
  window.addEventListener("resize", syncCanvasSize);
  document.addEventListener("fullscreenchange", syncCanvasSize);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { layerDirty = true; }).catch(() => {});
  }
  readAccent();
  syncCanvasSize();

  loadLevel(0, false);
  updateFullscreenButton();
  updateLandscapeTip();
  lastFrameTime = performance.now();
  window.requestAnimationFrame(gameLoop);
})();
