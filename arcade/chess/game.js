(() => {
  const GLYPH = {
    K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
    k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F"
  };
  const FILES = "abcdefgh";
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const START_COUNTS = { w: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }, b: { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 } };
  const WS_URL = window.CARTOFIA_CHESS_WS_URL || ((window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/ws/chess");
  const HEARTBEAT_MS = 20000;
  const DEFAULT_NAME = "Player";

  const boardEl = document.getElementById("board");
  const modeEl = document.getElementById("modeSelect");
  const diffEl = document.getElementById("difficultySelect");
  const newBtn = document.getElementById("newGameBtn");
  const statusEl = document.getElementById("statusLine");
  const logEl = document.getElementById("moveLog");
  const capWEl = document.getElementById("capturedByWhite");
  const capBEl = document.getElementById("capturedByBlack");

  const onlineBox = document.getElementById("onlineBox");
  const netStatusEl = document.getElementById("netStatus");
  const roomCodeEl = document.getElementById("roomCode");
  const roomPasswordEl = document.getElementById("roomPassword");
  const playerNameEl = document.getElementById("playerName");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const joinRoomBtn = document.getElementById("joinRoomBtn");
  const leaveRoomBtn = document.getElementById("leaveRoomBtn");
  const saveNameBtn = document.getElementById("saveNameBtn");
  const readyBtn = document.getElementById("readyBtn");
  const lobbyStateEl = document.getElementById("lobbyState");
  const lobbyListEl = document.getElementById("lobbyList");

  const st = {
    pos: null,
    mode: "multi",
    diff: "easy",
    botColor: "b",
    selected: null,
    selectedMoves: [],
    log: [],
    over: false,
    result: "",
    botThinking: false
  };

  const online = {
    ws: null,
    connected: false,
    room: "",
    hasPassword: false,
    clientId: "",
    role: "",
    participants: [],
    canStart: false,
    localReady: false,
    playerName: DEFAULT_NAME
  };

  function initBoard() {
    return [
      ["r", "n", "b", "q", "k", "b", "n", "r"],
      ["p", "p", "p", "p", "p", "p", "p", "p"],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["P", "P", "P", "P", "P", "P", "P", "P"],
      ["R", "N", "B", "Q", "K", "B", "N", "R"]
    ];
  }

  function initPos() {
    return {
      board: initBoard(),
      turn: "w",
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      moveNumber: 1
    };
  }

  function opp(c) { return c === "w" ? "b" : "w"; }
  function color(p) { return p ? (p === p.toUpperCase() ? "w" : "b") : null; }
  function type(p) { return p ? p.toLowerCase() : ""; }
  function inb(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function cloneBoard(board) { return board.map((row) => row.slice()); }
  function sq(r, c) { return FILES[c] + String(8 - r); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function makeMove(fr, fc, tr, tc, extra) {
    return Object.assign(
      { fromR: fr, fromC: fc, toR: tr, toC: tc, enPassant: false, castling: "", promotion: "", capture: false },
      extra || {}
    );
  }

  function serializeMove(m) {
    return {
      fromR: Number(m.fromR), fromC: Number(m.fromC), toR: Number(m.toR), toC: Number(m.toC),
      enPassant: !!m.enPassant, castling: String(m.castling || ""), promotion: String(m.promotion || ""), capture: !!m.capture
    };
  }

  function sameMove(a, b) {
    return a.fromR === b.fromR && a.fromC === b.fromC && a.toR === b.toR && a.toC === b.toC
      && (!!a.enPassant === !!b.enPassant)
      && String(a.castling || "") === String(b.castling || "")
      && String(a.promotion || "") === String(b.promotion || "");
  }

  function parseMove(data) {
    if (!data || typeof data !== "object") return null;
    const m = {
      fromR: Number(data.fromR), fromC: Number(data.fromC), toR: Number(data.toR), toC: Number(data.toC),
      enPassant: !!data.enPassant, castling: String(data.castling || ""), promotion: String(data.promotion || ""), capture: !!data.capture
    };
    if (!inb(m.fromR, m.fromC) || !inb(m.toR, m.toC)) return null;
    return m;
  }

  function pseudo(pos, r, c, attackOnly) {
    const b = pos.board;
    const p = b[r][c];
    if (!p) return [];
    const col = color(p);
    const t = type(p);
    const out = [];

    if (t === "p") {
      const d = col === "w" ? -1 : 1;
      const startRow = col === "w" ? 6 : 1;
      const one = r + d;
      if (!attackOnly && inb(one, c) && !b[one][c]) {
        out.push(makeMove(r, c, one, c, (one === 0 || one === 7) ? { promotion: "q" } : {}));
        const two = r + d * 2;
        if (r === startRow && !b[two][c]) out.push(makeMove(r, c, two, c));
      }
      [-1, 1].forEach((dc) => {
        const tr = r + d;
        const tc = c + dc;
        if (!inb(tr, tc)) return;
        if (attackOnly) {
          out.push(makeMove(r, c, tr, tc));
          return;
        }
        const target = b[tr][tc];
        if (target && color(target) === opp(col)) {
          out.push(makeMove(r, c, tr, tc, Object.assign({ capture: true }, (tr === 0 || tr === 7) ? { promotion: "q" } : {})));
        } else if (pos.enPassant && pos.enPassant.r === tr && pos.enPassant.c === tc) {
          out.push(makeMove(r, c, tr, tc, { capture: true, enPassant: true }));
        }
      });
      return out;
    }

    if (t === "n") {
      [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach((d) => {
        const tr = r + d[0];
        const tc = c + d[1];
        if (!inb(tr, tc)) return;
        const target = b[tr][tc];
        if (!target || color(target) !== col) out.push(makeMove(r, c, tr, tc, { capture: !!target }));
      });
      return out;
    }

    const dirs = [];
    if (t === "b" || t === "q") dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if (t === "r" || t === "q") dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    if (dirs.length) {
      dirs.forEach((d) => {
        let tr = r + d[0];
        let tc = c + d[1];
        while (inb(tr, tc)) {
          const target = b[tr][tc];
          if (!target) {
            out.push(makeMove(r, c, tr, tc));
          } else {
            if (color(target) !== col) out.push(makeMove(r, c, tr, tc, { capture: true }));
            break;
          }
          tr += d[0];
          tc += d[1];
        }
      });
      return out;
    }

    if (t === "k") {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (!dr && !dc) continue;
          const tr = r + dr;
          const tc = c + dc;
          if (!inb(tr, tc)) continue;
          const target = b[tr][tc];
          if (!target || color(target) !== col) out.push(makeMove(r, c, tr, tc, { capture: !!target }));
        }
      }
      if (!attackOnly) {
        const row = col === "w" ? 7 : 0;
        if (r === row && c === 4) {
          if ((col === "w" ? pos.castling.wK : pos.castling.bK) && !b[row][5] && !b[row][6]) {
            if (!attacked(pos, row, 4, opp(col)) && !attacked(pos, row, 5, opp(col)) && !attacked(pos, row, 6, opp(col)) && b[row][7] && type(b[row][7]) === "r") {
              out.push(makeMove(r, c, row, 6, { castling: "K" }));
            }
          }
          if ((col === "w" ? pos.castling.wQ : pos.castling.bQ) && !b[row][1] && !b[row][2] && !b[row][3]) {
            if (!attacked(pos, row, 4, opp(col)) && !attacked(pos, row, 3, opp(col)) && !attacked(pos, row, 2, opp(col)) && b[row][0] && type(b[row][0]) === "r") {
              out.push(makeMove(r, c, row, 2, { castling: "Q" }));
            }
          }
        }
      }
    }

    return out;
  }

  function attacked(pos, r, c, by) {
    for (let rr = 0; rr < 8; rr += 1) {
      for (let cc = 0; cc < 8; cc += 1) {
        const p = pos.board[rr][cc];
        if (!p || color(p) !== by) continue;
        const pm = pseudo(pos, rr, cc, true);
        for (let i = 0; i < pm.length; i += 1) {
          if (pm[i].toR === r && pm[i].toC === c) return true;
        }
      }
    }
    return false;
  }

  function inCheck(pos, col) {
    const king = col === "w" ? "K" : "k";
    let kr = -1;
    let kc = -1;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        if (pos.board[r][c] === king) {
          kr = r;
          kc = c;
          break;
        }
      }
      if (kr !== -1) break;
    }
    if (kr === -1) return true;
    return attacked(pos, kr, kc, opp(col));
  }

  function apply(pos, m) {
    const n = {
      board: cloneBoard(pos.board),
      turn: opp(pos.turn),
      castling: Object.assign({}, pos.castling),
      enPassant: null,
      moveNumber: pos.moveNumber + (pos.turn === "b" ? 1 : 0)
    };
    const b = n.board;
    const p = b[m.fromR][m.fromC];
    const col = color(p);
    const t = type(p);
    const target = b[m.toR][m.toC];
    b[m.fromR][m.fromC] = "";
    if (m.enPassant) {
      const capR = col === "w" ? m.toR + 1 : m.toR - 1;
      b[capR][m.toC] = "";
    }
    b[m.toR][m.toC] = p;
    if (m.castling === "K") {
      const row = col === "w" ? 7 : 0;
      b[row][5] = b[row][7];
      b[row][7] = "";
    } else if (m.castling === "Q") {
      const row = col === "w" ? 7 : 0;
      b[row][3] = b[row][0];
      b[row][0] = "";
    }
    if (m.promotion) b[m.toR][m.toC] = col === "w" ? m.promotion.toUpperCase() : m.promotion;

    if (t === "k") {
      if (col === "w") {
        n.castling.wK = false;
        n.castling.wQ = false;
      } else {
        n.castling.bK = false;
        n.castling.bQ = false;
      }
    }
    if (t === "r") {
      if (m.fromR === 7 && m.fromC === 0) n.castling.wQ = false;
      if (m.fromR === 7 && m.fromC === 7) n.castling.wK = false;
      if (m.fromR === 0 && m.fromC === 0) n.castling.bQ = false;
      if (m.fromR === 0 && m.fromC === 7) n.castling.bK = false;
    }
    if (target && type(target) === "r") {
      if (m.toR === 7 && m.toC === 0) n.castling.wQ = false;
      if (m.toR === 7 && m.toC === 7) n.castling.wK = false;
      if (m.toR === 0 && m.toC === 0) n.castling.bQ = false;
      if (m.toR === 0 && m.toC === 7) n.castling.bK = false;
    }
    if (t === "p" && Math.abs(m.toR - m.fromR) === 2) {
      n.enPassant = { r: (m.toR + m.fromR) / 2, c: m.fromC };
    }
    return n;
  }

  function legal(pos, col) {
    const out = [];
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const p = pos.board[r][c];
        if (!p || color(p) !== col) continue;
        const ps = pseudo(pos, r, c, false);
        ps.forEach((m) => {
          const nx = apply(pos, m);
          if (!inCheck(nx, col)) out.push(m);
        });
      }
    }
    return out;
  }

  function note(pos, m) {
    if (m.castling === "K") return "O-O";
    if (m.castling === "Q") return "O-O-O";
    const p = pos.board[m.fromR][m.fromC];
    const mark = type(p) === "p" ? "" : type(p).toUpperCase();
    const cap = m.capture || m.enPassant ? "x" : "-";
    return mark + sq(m.fromR, m.fromC) + cap + sq(m.toR, m.toC) + (m.promotion ? "=Q" : "");
  }

  function evalPos(pos, persp) {
    let score = 0;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const p = pos.board[r][c];
        if (!p) continue;
        const col = color(p);
        const val = VALUE[type(p)] + ((r >= 2 && r <= 5 && c >= 2 && c <= 5) ? 8 : 0);
        score += col === "w" ? val : -val;
      }
    }
    return persp === "w" ? score : -score;
  }

  function mm(pos, depth, alpha, beta, persp) {
    const moves = legal(pos, pos.turn);
    if (!depth || !moves.length) {
      if (!moves.length) {
        if (inCheck(pos, pos.turn)) return pos.turn === persp ? -100000 : 100000;
        return 0;
      }
      return evalPos(pos, persp);
    }
    const ordered = moves.slice().sort((a, b) => Number(b.capture) - Number(a.capture));
    if (pos.turn === persp) {
      let best = -Infinity;
      for (let i = 0; i < ordered.length; i += 1) {
        const v = mm(apply(pos, ordered[i]), depth - 1, alpha, beta, persp);
        if (v > best) best = v;
        if (v > alpha) alpha = v;
        if (beta <= alpha) break;
      }
      return best;
    }
    let best = Infinity;
    for (let i = 0; i < ordered.length; i += 1) {
      const v = mm(apply(pos, ordered[i]), depth - 1, alpha, beta, persp);
      if (v < best) best = v;
      if (v < beta) beta = v;
      if (beta <= alpha) break;
    }
    return best;
  }

  function pickBot() {
    const moves = legal(st.pos, st.botColor);
    if (!moves.length) return null;
    if (st.diff === "easy") return moves[Math.floor(Math.random() * moves.length)];
    if (st.diff === "medium") {
      let best = -Infinity;
      let choice = moves[0];
      moves.forEach((m) => {
        const v = evalPos(apply(st.pos, m), st.botColor) + Math.random() * 8;
        if (v > best) {
          best = v;
          choice = m;
        }
      });
      return choice;
    }
    let best = -Infinity;
    let pick = moves[0];
    moves.forEach((m) => {
      const v = mm(apply(st.pos, m), 2, -Infinity, Infinity, st.botColor);
      if (v > best) {
        best = v;
        pick = m;
      }
    });
    return pick;
  }

  function counts(board) {
    const c = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
    for (let r = 0; r < 8; r += 1) {
      for (let col = 0; col < 8; col += 1) {
        const p = board[r][col];
        if (p) c[color(p)][type(p)] += 1;
      }
    }
    return c;
  }

  function updateCaptured() {
    const c = counts(st.pos.board);
    const byW = [];
    const byB = [];
    ["q", "r", "b", "n", "p"].forEach((t) => {
      for (let i = 0; i < START_COUNTS.b[t] - c.b[t]; i += 1) byW.push(GLYPH[t]);
      for (let i = 0; i < START_COUNTS.w[t] - c.w[t]; i += 1) byB.push(GLYPH[t.toUpperCase()]);
    });
    capWEl.textContent = byW.join(" ");
    capBEl.textContent = byB.join(" ");
  }

  function renderLog() {
    logEl.innerHTML = "";
    if (!st.log.length) {
      const e = document.createElement("div");
      e.textContent = "No moves yet.";
      e.style.color = "#90a8c6";
      logEl.appendChild(e);
      return;
    }
    st.log.forEach((line) => {
      const d = document.createElement("div");
      d.textContent = line;
      logEl.appendChild(d);
    });
    logEl.scrollTop = logEl.scrollHeight;
  }

  function netState(kind, text) {
    netStatusEl.classList.remove("ok", "warn");
    if (kind === "ok" || kind === "warn") netStatusEl.classList.add(kind);
    netStatusEl.textContent = text;
  }

  function normalizeName(raw) {
    const cleaned = String(raw || "").replace(/[^a-zA-Z0-9 _-]/g, "").trim();
    return cleaned ? cleaned.slice(0, 16) : DEFAULT_NAME;
  }

  function normalizeRoomCode(raw) {
    return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function randomRoomCode() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function updateReadyButton() {
    readyBtn.textContent = "Ready: " + (online.localReady ? "On" : "Off");
    readyBtn.classList.toggle("btn-primary", online.localReady);
    readyBtn.classList.toggle("btn-ghost", !online.localReady);
  }

  function renderLobby() {
    lobbyListEl.innerHTML = "";
    if (!online.connected) {
      lobbyStateEl.textContent = "Connect to a room.";
      return;
    }
    const list = Array.isArray(online.participants) ? online.participants : [];
    list.forEach((p, idx) => {
      const li = document.createElement("li");
      const left = document.createElement("span");
      const role = p && p.role === "host" ? "Host" : "Guest";
      const name = normalizeName((p && p.name) || ("P" + (idx + 1)));
      left.textContent = name + " (" + role + ")";
      const right = document.createElement("span");
      right.className = p && p.ready ? "lobby-ready" : "lobby-wait";
      right.textContent = p && p.ready ? "Ready" : "Not ready";
      li.appendChild(left);
      li.appendChild(right);
      lobbyListEl.appendChild(li);
    });
    if (list.length < 2) lobbyStateEl.textContent = "Waiting for second player in room " + online.room + ".";
    else if (!online.canStart) lobbyStateEl.textContent = "Both players must be Ready.";
    else lobbyStateEl.textContent = "Ready to play. Host = White, Guest = Black.";
  }

  function onlineModePlayable() {
    return st.mode === "online" && online.connected && online.participants.length >= 2 && online.canStart;
  }

  function localOnlineColor() {
    if (online.role === "host") return "w";
    if (online.role === "guest") return "b";
    return "";
  }

  function status(text) {
    if (st.over) {
      statusEl.textContent = st.result;
      return;
    }
    if (text) {
      statusEl.textContent = text;
      return;
    }
    if (st.botThinking) {
      statusEl.textContent = "Bot is thinking...";
      return;
    }
    if (st.mode === "online") {
      if (!online.connected) {
        statusEl.textContent = "Online mode: create or join a room.";
        return;
      }
      if (online.participants.length < 2) {
        statusEl.textContent = "Room " + online.room + ": waiting for second player.";
        return;
      }
      if (!online.canStart) {
        statusEl.textContent = "Room " + online.room + ": waiting for both players Ready.";
        return;
      }
      const side = st.pos.turn === "w" ? "White" : "Black";
      const my = localOnlineColor();
      statusEl.textContent = side + " to move. " + (my === st.pos.turn ? "Your turn." : "Opponent turn.");
      return;
    }
    statusEl.textContent = st.pos.turn === "w" ? "White to move." : "Black to move.";
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "sq " + (((r + c) % 2 === 0) ? "light" : "dark");
        b.dataset.r = String(r);
        b.dataset.c = String(c);
        const p = st.pos.board[r][c];
        if (p) {
          b.textContent = GLYPH[p];
          b.classList.add(color(p) === "w" ? "piece-white" : "piece-black");
        }
        if (st.selected && st.selected.r === r && st.selected.c === c) b.classList.add("selected");
        const hit = st.selectedMoves.find((m) => m.toR === r && m.toC === c);
        if (hit) b.classList.add(hit.capture || hit.enPassant ? "capture" : "move");
        if (!isSquareEnabled()) b.classList.add("disabled");
        b.addEventListener("click", onSquare);
        boardEl.appendChild(b);
      }
    }
  }

  function renderAll(extraStatus) {
    diffEl.disabled = st.mode !== "bot";
    onlineBox.classList.toggle("hidden", st.mode !== "online");
    renderBoard();
    renderLog();
    updateCaptured();
    renderLobby();
    updateReadyButton();
    status(extraStatus);
  }

  function legalFrom(r, c) {
    return legal(st.pos, st.pos.turn).filter((m) => m.fromR === r && m.fromC === c);
  }

  function finalizeTurn() {
    const ms = legal(st.pos, st.pos.turn);
    if (!ms.length) {
      st.over = true;
      if (inCheck(st.pos, st.pos.turn)) st.result = st.pos.turn === "w" ? "Checkmate. Black wins." : "Checkmate. White wins.";
      else st.result = "Stalemate.";
    }
  }

  function applyMoveAndLog(m) {
    const n = note(st.pos, m);
    st.pos = apply(st.pos, m);
    const idx = st.log.length;
    const moveNo = Math.floor(idx / 2) + 1;
    st.log.push((idx % 2 === 0 ? moveNo + ". " : moveNo + "... ") + n);
    st.selected = null;
    st.selectedMoves = [];
    st.botThinking = false;
    finalizeTurn();
  }

  function maybeDoBotMove() {
    if (st.over || st.mode !== "bot" || st.pos.turn !== st.botColor) return;
    st.botThinking = true;
    status();
    setTimeout(() => {
      if (st.over || st.mode !== "bot" || st.pos.turn !== st.botColor) return;
      const bm = pickBot();
      if (bm) {
        applyMoveAndLog(bm);
        renderAll();
        maybeDoBotMove();
      }
    }, 260);
  }

  function resetLocalGame() {
    st.pos = initPos();
    st.selected = null;
    st.selectedMoves = [];
    st.log = [];
    st.over = false;
    st.result = "";
    st.botThinking = false;
    renderAll();
    maybeDoBotMove();
  }

  function serializePos(pos) {
    return {
      board: pos.board.map((row) => row.slice()),
      turn: pos.turn,
      castling: Object.assign({}, pos.castling),
      enPassant: pos.enPassant ? { r: Number(pos.enPassant.r), c: Number(pos.enPassant.c) } : null,
      moveNumber: Number(pos.moveNumber || 1)
    };
  }

  function parsePos(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.board) || data.board.length !== 8) return null;
    const board = [];
    for (let r = 0; r < 8; r += 1) {
      const row = data.board[r];
      if (!Array.isArray(row) || row.length !== 8) return null;
      board.push(row.map((p) => (typeof p === "string" ? p.slice(0, 1) : "")));
    }
    const turn = data.turn === "b" ? "b" : "w";
    const castling = Object.assign({ wK: false, wQ: false, bK: false, bQ: false }, data.castling || {});
    let enPassant = null;
    if (data.enPassant && typeof data.enPassant === "object") {
      const er = Number(data.enPassant.r);
      const ec = Number(data.enPassant.c);
      if (inb(er, ec)) enPassant = { r: er, c: ec };
    }
    const moveNumber = clamp(Number(data.moveNumber || 1), 1, 9999);
    return { board, turn, castling, enPassant, moveNumber };
  }

  function serializeState() {
    return {
      pos: serializePos(st.pos),
      log: st.log.slice(),
      over: !!st.over,
      result: String(st.result || "")
    };
  }

  function applyRemoteState(packet) {
    const p = parsePos(packet && packet.pos);
    if (!p) return;
    st.pos = p;
    st.log = Array.isArray(packet.log) ? packet.log.slice(0, 600).map((x) => String(x)) : [];
    st.over = !!(packet && packet.over);
    st.result = String((packet && packet.result) || "");
    st.selected = null;
    st.selectedMoves = [];
    st.botThinking = false;
    renderAll();
  }

  function sendOnline(payload) {
    if (!online.ws || online.ws.readyState !== WebSocket.OPEN) return false;
    try {
      online.ws.send(JSON.stringify(payload));
      return true;
    } catch (_e) {
      return false;
    }
  }

  function sendRelay(payload) { return sendOnline(payload || {}); }
  function sendLobby(payload) { return sendOnline(Object.assign({ type: "lobby" }, payload || {})); }

  function broadcastState(reason) {
    if (st.mode !== "online" || online.role !== "host" || !online.connected) return;
    sendRelay({ kind: "state_update", reason: String(reason || ""), state: serializeState() });
  }

  function setDisconnected() {
    online.connected = false;
    online.clientId = "";
    online.role = "";
    online.participants = [];
    online.canStart = false;
    online.hasPassword = false;
    online.localReady = false;
  }

  function closeSocket(message, keepRoom) {
    if (online.ws) {
      try {
        if (online.ws.readyState === WebSocket.OPEN) sendOnline({ type: "leave" });
        online.ws.close();
      } catch (_e) {
        // ignore
      }
    }
    online.ws = null;
    setDisconnected();
    if (!keepRoom) online.room = "";
    if (st.mode === "online") {
      netState("warn", online.room ? ("Disconnected (" + online.room + ")") : "Offline");
      renderAll(message || "Disconnected.");
    }
  }

  function handleRelay(payload) {
    if (!payload || typeof payload !== "object") return;
    const kind = String(payload.kind || "");

    if (kind === "request_sync" && online.role === "host") {
      sendRelay({ kind: "state_sync", state: serializeState() });
      return;
    }
    if ((kind === "state_update" || kind === "state_sync") && online.role === "guest") {
      applyRemoteState(payload.state || {});
      return;
    }
    if (kind === "start_request" && online.role === "host" && onlineModePlayable()) {
      resetLocalGame();
      broadcastState("host_start");
      return;
    }
    if (kind === "reset_request" && online.role === "host" && onlineModePlayable()) {
      resetLocalGame();
      broadcastState("host_reset");
      return;
    }
    if (kind === "move_request" && online.role === "host" && onlineModePlayable()) {
      const move = parseMove(payload.move);
      if (!move || st.pos.turn !== "b") return;
      const all = legal(st.pos, st.pos.turn);
      const matched = all.find((m) => sameMove(m, move));
      if (!matched) {
        sendRelay({ kind: "state_sync", state: serializeState() });
        return;
      }
      applyMoveAndLog(matched);
      renderAll();
      broadcastState("guest_move");
    }
  }

  function savePlayerName() {
    online.playerName = normalizeName(playerNameEl.value);
    playerNameEl.value = online.playerName;
    try {
      window.localStorage.setItem("cartofia_chess_name", online.playerName);
    } catch (_e) {
      // ignore
    }
  }

  function connectRoom(rawCode) {
    const code = normalizeRoomCode(rawCode);
    roomCodeEl.value = code;
    if (code.length < 4) {
      renderAll("Room code must be at least 4 characters.");
      return;
    }

    savePlayerName();
    closeSocket("", true);
    online.room = code;
    netState("warn", "Connecting...");

    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch (_e) {
      netState("warn", "Socket error");
      renderAll("Could not open websocket.");
      return;
    }
    online.ws = ws;

    ws.addEventListener("open", () => {
      const sent = sendOnline({
        type: "join",
        room: code,
        password: String(roomPasswordEl.value || "").slice(0, 32),
        name: online.playerName
      });
      if (!sent) netState("warn", "Join failed");
      else netState("warn", "Joining room...");
    });

    ws.addEventListener("message", (event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
      } catch (_e) {
        return;
      }
      if (!data || typeof data !== "object") return;

      if (data.type === "error") {
        netState("warn", String(data.message || "Connection error"));
        renderAll(String(data.message || "Room error"));
        return;
      }

      if (data.type === "joined") {
        online.connected = true;
        online.room = String(data.room || code);
        online.clientId = String(data.client_id || "");
        online.role = String(data.role || "");
        online.participants = Array.isArray(data.participants) ? data.participants : [];
        online.canStart = !!data.can_start;
        online.hasPassword = !!data.has_password;
        roomCodeEl.value = online.room;
        netState("ok", "Online: " + online.room + " (" + (online.role || "-") + ")");
        sendLobby({ name: online.playerName, ready: online.localReady });
        if (online.role === "guest") sendRelay({ kind: "request_sync" });
        if (online.role === "host") broadcastState("host_joined");
        renderAll();
        return;
      }

      if (data.type === "room_state") {
        online.participants = Array.isArray(data.participants) ? data.participants : [];
        online.canStart = !!data.can_start;
        online.hasPassword = !!data.has_password;
        if (online.connected && online.role === "host" && online.participants.length >= 2) broadcastState("room_sync");
        renderAll();
        return;
      }

      if (data.type === "relay") {
        handleRelay(data.payload || {});
        return;
      }
    });

    ws.addEventListener("close", () => {
      const wasOnline = st.mode === "online";
      setDisconnected();
      online.ws = null;
      if (wasOnline) {
        netState("warn", "Disconnected");
        renderAll("Disconnected from room.");
      }
    });

    ws.addEventListener("error", () => {
      netState("warn", "Socket error");
    });
  }

  function sendGuestMove(m) {
    if (!online.connected || online.role !== "guest") return;
    sendRelay({ kind: "move_request", move: serializeMove(m), turn: st.pos.turn, move_number: st.pos.moveNumber });
  }

  function startOnlineRound() {
    if (!online.connected) {
      renderAll("Connect to a room first.");
      return;
    }
    if (!online.canStart || online.participants.length < 2) {
      renderAll("Room needs two ready players.");
      return;
    }
    if (online.role === "host") {
      resetLocalGame();
      broadcastState("host_start");
    } else {
      sendRelay({ kind: "start_request" });
      renderAll("Start request sent to host.");
    }
  }

  function isSquareEnabled() {
    if (st.over || st.botThinking) return false;
    if (st.mode === "bot" && st.pos.turn === st.botColor) return false;
    if (st.mode === "online") {
      if (!onlineModePlayable()) return false;
      if (st.pos.turn !== localOnlineColor()) return false;
    }
    return true;
  }

  function onSquare(event) {
    if (!isSquareEnabled()) return;
    const r = Number(event.currentTarget.dataset.r);
    const c = Number(event.currentTarget.dataset.c);
    const p = st.pos.board[r][c];

    if (st.selected) {
      const chosen = st.selectedMoves.find((m) => m.toR === r && m.toC === c);
      if (chosen) {
        if (st.mode === "online") {
          if (online.role === "host") {
            applyMoveAndLog(chosen);
            renderAll();
            broadcastState("host_move");
          } else if (online.role === "guest") {
            st.selected = null;
            st.selectedMoves = [];
            renderAll("Move sent to host...");
            sendGuestMove(chosen);
          }
        } else {
          applyMoveAndLog(chosen);
          renderAll();
          maybeDoBotMove();
        }
        return;
      }
    }

    if (p && color(p) === st.pos.turn) {
      st.selected = { r: r, c: c };
      st.selectedMoves = legalFrom(r, c);
    } else {
      st.selected = null;
      st.selectedMoves = [];
    }
    renderAll();
  }

  function switchMode(nextMode) {
    const old = st.mode;
    st.mode = nextMode;
    if (old === "online" && nextMode !== "online") closeSocket("", false);
    if (nextMode === "online") netState(online.connected ? "ok" : "warn", online.connected ? ("Online: " + online.room) : "Offline");
    resetLocalGame();
  }

  function loadPlayerName() {
    try {
      online.playerName = normalizeName(window.localStorage.getItem("cartofia_chess_name") || DEFAULT_NAME);
    } catch (_e) {
      online.playerName = DEFAULT_NAME;
    }
    playerNameEl.value = online.playerName;
  }

  modeEl.addEventListener("change", () => switchMode(modeEl.value));
  diffEl.addEventListener("change", () => { st.diff = diffEl.value; });
  newBtn.addEventListener("click", () => {
    if (st.mode === "online") startOnlineRound();
    else resetLocalGame();
  });

  roomCodeEl.addEventListener("input", () => { roomCodeEl.value = normalizeRoomCode(roomCodeEl.value); });
  roomCodeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); connectRoom(roomCodeEl.value); } });
  roomPasswordEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); connectRoom(roomCodeEl.value); } });
  playerNameEl.addEventListener("input", () => { playerNameEl.value = normalizeName(playerNameEl.value); });
  playerNameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      savePlayerName();
      if (online.connected) sendLobby({ name: online.playerName });
    }
  });

  createRoomBtn.addEventListener("click", () => {
    if (st.mode !== "online") {
      modeEl.value = "online";
      switchMode("online");
    }
    const code = randomRoomCode();
    roomCodeEl.value = code;
    connectRoom(code);
  });
  joinRoomBtn.addEventListener("click", () => {
    if (st.mode !== "online") {
      modeEl.value = "online";
      switchMode("online");
    }
    connectRoom(roomCodeEl.value);
  });
  leaveRoomBtn.addEventListener("click", () => closeSocket("Left online room.", false));
  saveNameBtn.addEventListener("click", () => {
    savePlayerName();
    if (online.connected) sendLobby({ name: online.playerName });
  });
  readyBtn.addEventListener("click", () => {
    if (!online.connected) return;
    online.localReady = !online.localReady;
    updateReadyButton();
    sendLobby({ ready: online.localReady });
  });

  setInterval(() => {
    if (online.ws && online.ws.readyState === WebSocket.OPEN) sendOnline({ type: "heartbeat" });
  }, HEARTBEAT_MS);

  window.addEventListener("beforeunload", () => closeSocket("", false));

  loadPlayerName();
  st.mode = modeEl.value;
  st.diff = diffEl.value;
  netState("warn", "Offline");
  resetLocalGame();
})();
