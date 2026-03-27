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
  let particles = [];

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

  function updateHud() {
    levelEl.textContent = String(levelIndex + 1) + " / " + String(LEVELS.length);
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    remainingEl.textContent = String(getRemainingCount());
    stateEl.textContent = stateText();
    syncActionBar();
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
    gameState = nextState;
    if (nextState === "running") {
      setOverlay("", false);
    } else if (typeof overlayText === "string") {
      setOverlay(overlayText, true);
    }
    updateHud();
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
    for (let i = 0; i < amount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (force * 0.45) + (Math.random() * force);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.45 + (Math.random() * 0.35),
        maxLife: 0.45 + (Math.random() * 0.35),
        size: 1.5 + (Math.random() * 2.8),
        color: color
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
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
    spawned += 1;
  }

  function loadLevel(index, keepScore) {
    levelIndex = clamp(index, 0, LEVELS.length - 1);
    path = compilePath(getPathPoints(currentLevel().path));
    chain = [];
    shots = [];
    particles = [];
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
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    aimAngle = Math.atan2(y - SHOOTER_Y, x - SHOOTER_X);
  }

  function swapShooterColors() {
    const temp = currentColor;
    currentColor = nextColor;
    nextColor = temp;
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

    chain.push(ball);
    chain.sort((a, b) => a.offset - b.offset);
    enforceMinimumSpacing();

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

  function drawPath(now) {
    const pulse = 0.58 + (Math.sin(now / 680) * 0.22);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i += 1) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.lineWidth = 40;
    ctx.strokeStyle = "rgba(5, 12, 22, 0.88)";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i += 1) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.lineWidth = 27;
    ctx.strokeStyle = "rgba(16, 36, 57, 0.98)";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i += 1) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(95, 194, 255, " + String(0.24 + (pulse * 0.24)) + ")";
    ctx.stroke();

    const start = path.points[0];
    const end = path.points[path.points.length - 1];

    ctx.beginPath();
    ctx.arc(start.x, start.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(44, 190, 255, 0.22)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(94, 205, 255, 0.66)";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(end.x, end.y, 20, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(180, 34, 46, " + String(0.26 + (pulse * 0.2)) + ")";
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "rgba(255, 118, 128, 0.82)";
    ctx.stroke();

    ctx.fillStyle = "rgba(252, 228, 232, 0.9)";
    ctx.font = "700 10px Sora, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("X", end.x, end.y + 0.5);

    // Temple runes along route for extra depth.
    ctx.font = "700 10px Sora, sans-serif";
    ctx.fillStyle = "rgba(164, 210, 245, 0.28)";
    const glyphs = ["+", "o", "x", "o"];
    for (let d = 70, g = 0; d < path.total - 45; d += 90, g += 1) {
      const p = pointOnPath(d);
      ctx.fillText(glyphs[g % glyphs.length], p.x, p.y + 0.5);
    }

    ctx.restore();
  }

  function drawBall(x, y, radius, color) {
    ctx.save();

    const glow = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius * 1.9);
    glow.addColorStop(0, "rgba(220, 245, 255, 0.22)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.85, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(
      x - (radius * 0.36),
      y - (radius * 0.42),
      radius * 0.16,
      x,
      y,
      radius
    );
    grad.addColorStop(0, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.35, color);
    grad.addColorStop(1, "rgba(0,0,0,0.58)");

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(220, 238, 255, 0.52)";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x - (radius * 0.22), y - (radius * 0.24), radius * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.36)";
    ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = colorWithAlpha(p.color, alpha * 0.94);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawChain() {
    for (let i = 0; i < chain.length; i += 1) {
      const marble = chain[i];
      const p = pointOnPath(marble.offset);
      ctx.beginPath();
      ctx.arc(p.x, p.y + 2.4, BALL_RADIUS + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(1, 5, 10, 0.34)";
      ctx.fill();
      drawBall(p.x, p.y, BALL_RADIUS, marble.color);
    }
  }

  function drawShots() {
    for (let i = 0; i < shots.length; i += 1) {
      const shot = shots[i];
      drawBall(shot.x, shot.y, BALL_RADIUS * 0.9, shot.color);
    }
  }

  function drawShooter() {
    ctx.save();

    const halo = ctx.createRadialGradient(SHOOTER_X, SHOOTER_Y, SHOOTER_RADIUS * 0.6, SHOOTER_X, SHOOTER_Y, SHOOTER_RADIUS * 2.4);
    halo.addColorStop(0, "rgba(101, 187, 255, 0.20)");
    halo.addColorStop(1, "rgba(101, 187, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(SHOOTER_X, SHOOTER_Y, SHOOTER_RADIUS * 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(SHOOTER_X, SHOOTER_Y, SHOOTER_RADIUS + 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6, 18, 30, 0.95)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(84, 174, 240, 0.58)";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(SHOOTER_X, SHOOTER_Y, SHOOTER_RADIUS - 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(9, 31, 51, 0.92)";
    ctx.fill();

    const cx = Math.cos(aimAngle);
    const cy = Math.sin(aimAngle);
    const cannonLen = SHOOTER_RADIUS + 16;

    ctx.beginPath();
    ctx.moveTo(SHOOTER_X, SHOOTER_Y);
    ctx.lineTo(SHOOTER_X + (cx * cannonLen), SHOOTER_Y + (cy * cannonLen));
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(33, 94, 145, 0.98)";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(SHOOTER_X, SHOOTER_Y);
    ctx.lineTo(SHOOTER_X + (cx * cannonLen), SHOOTER_Y + (cy * cannonLen));
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(151, 215, 255, 0.84)";
    ctx.stroke();

    drawBall(
      SHOOTER_X + (cx * (SHOOTER_RADIUS + BALL_RADIUS + 4)),
      SHOOTER_Y + (cy * (SHOOTER_RADIUS + BALL_RADIUS + 4)),
      BALL_RADIUS,
      currentColor || "#6fa8ff"
    );

    drawBall(
      SHOOTER_X - 34,
      SHOOTER_Y + 34,
      BALL_RADIUS * 0.85,
      nextColor || "#6fa8ff"
    );

    ctx.restore();
  }

  function drawMeta() {
    const level = currentLevel();
    const progress = clamp(1 - (getRemainingCount() / level.marbles), 0, 1);

    ctx.save();
    ctx.fillStyle = "rgba(8, 15, 24, 0.7)";
    ctx.fillRect(16, HEIGHT - 26, WIDTH - 32, 10);
    ctx.fillStyle = "rgba(94, 195, 255, 0.74)";
    ctx.fillRect(16, HEIGHT - 26, (WIDTH - 32) * progress, 10);

    ctx.fillStyle = "rgba(210, 232, 255, 0.94)";
    ctx.font = "600 14px Manrope, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Level " + String(levelIndex + 1) + " - " + level.name, 16, 14);
    ctx.restore();
  }

  function drawBackground(now) {
    const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    bg.addColorStop(0, "#06172d");
    bg.addColorStop(0.58, "#031022");
    bg.addColorStop(1, "#010710");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const drift = now * 0.00018;
    const veil = ctx.createRadialGradient(
      WIDTH * (0.24 + (Math.sin(drift) * 0.06)),
      HEIGHT * 0.2,
      20,
      WIDTH * 0.24,
      HEIGHT * 0.2,
      420
    );
    veil.addColorStop(0, "rgba(88, 180, 245, 0.15)");
    veil.addColorStop(1, "rgba(88, 180, 245, 0)");
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const veil2 = ctx.createRadialGradient(
      WIDTH * (0.82 + (Math.cos(drift * 0.8) * 0.05)),
      HEIGHT * 0.15,
      20,
      WIDTH * 0.82,
      HEIGHT * 0.15,
      400
    );
    veil2.addColorStop(0, "rgba(115, 143, 255, 0.13)");
    veil2.addColorStop(1, "rgba(115, 143, 255, 0)");
    ctx.fillStyle = veil2;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "rgba(52, 126, 198, 0.11)";
    for (let i = 0; i < 26; i += 1) {
      const x = ((i * 89) % WIDTH) + 12 + (Math.sin(drift + (i * 0.6)) * 4.2);
      const y = ((i * 57) % HEIGHT) + 8 + (Math.cos(drift + (i * 0.32)) * 3.2);
      ctx.beginPath();
      ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(120, 180, 236, 0.05)";
    ctx.lineWidth = 1;
    for (let y = 48; y < HEIGHT; y += 54) {
      ctx.beginPath();
      ctx.moveTo(0, y + (Math.sin(drift + (y * 0.02)) * 2.5));
      ctx.lineTo(WIDTH, y + (Math.sin(drift + (y * 0.02)) * 2.5));
      ctx.stroke();
    }
  }

  function render(now) {
    drawBackground(now);
    drawPath(now);
    drawChain();
    drawParticles();
    drawShots();
    drawShooter();
    drawMeta();
    updateHud();
  }

  function gameLoop(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.035);
    lastFrameTime = now;

    updateParticles(dt);
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

  loadLevel(0, false);
  updateFullscreenButton();
  updateLandscapeTip();
  lastFrameTime = performance.now();
  window.requestAnimationFrame(gameLoop);
})();
