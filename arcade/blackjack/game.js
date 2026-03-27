(() => {
  const WS_URL = window.CARTOFIA_BLACKJACK_WS_URL || ((window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/ws/blackjack");
  const HEARTBEAT_MS = 20000;
  const DEFAULT_NAME = "Player";
  const SUIT_ICON = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" };
  const SUITS = ["S", "H", "D", "C"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];

  const phasePillEl = document.getElementById("phasePill");
  const tableStatusEl = document.getElementById("tableStatus");
  const dealerCardsEl = document.getElementById("dealerCards");
  const dealerTotalEl = document.getElementById("dealerTotal");
  const playersListEl = document.getElementById("playersList");
  const startRoundBtn = document.getElementById("startRoundBtn");
  const hitBtn = document.getElementById("hitBtn");
  const standBtn = document.getElementById("standBtn");

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

  const game = {
    phase: "lobby",
    round: 0,
    order: [],
    turnIndex: 0,
    dealer: { cards: [], reveal: false },
    hands: {},
    done: {},
    results: {},
    deck: []
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
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

  function netState(kind, text) {
    netStatusEl.classList.remove("ok", "warn");
    if (kind === "ok" || kind === "warn") netStatusEl.classList.add(kind);
    netStatusEl.textContent = text;
  }

  function updateReadyButton() {
    readyBtn.textContent = "Ready: " + (online.localReady ? "On" : "Off");
    readyBtn.classList.toggle("btn-primary", online.localReady);
    readyBtn.classList.toggle("btn-ghost", !online.localReady);
  }

  function playerNameById(id) {
    const p = online.participants.find((x) => String(x.id) === String(id));
    if (!p) return "Player";
    return normalizeName(p.name || "Player");
  }

  function currentTurnId() {
    if (!Array.isArray(game.order) || game.turnIndex < 0 || game.turnIndex >= game.order.length) return "";
    return String(game.order[game.turnIndex] || "");
  }

  function cardText(card) {
    if (!card || typeof card !== "string") return "?";
    const rank = card.slice(0, 1);
    const suit = card.slice(1, 2);
    return rank + (SUIT_ICON[suit] || suit);
  }

  function handValue(cards) {
    let total = 0;
    let aces = 0;
    (cards || []).forEach((card) => {
      const rank = String(card || "").slice(0, 1);
      if (rank === "A") {
        aces += 1;
        total += 11;
      } else if (rank === "T" || rank === "J" || rank === "Q" || rank === "K") {
        total += 10;
      } else {
        total += Number(rank) || 0;
      }
    });
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }

  function isBlackjack(cards) {
    return Array.isArray(cards) && cards.length === 2 && handValue(cards) === 21;
  }

  function buildShuffledDeck() {
    const deck = [];
    SUITS.forEach((suit) => {
      RANKS.forEach((rank) => {
        deck.push(rank + suit);
      });
    });
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  function drawCard() {
    if (!game.deck.length) game.deck = buildShuffledDeck();
    return game.deck.pop();
  }

  function resetRoundState() {
    game.phase = "lobby";
    game.order = [];
    game.turnIndex = 0;
    game.dealer = { cards: [], reveal: false };
    game.hands = {};
    game.done = {};
    game.results = {};
  }

  function renderLobby() {
    lobbyListEl.innerHTML = "";
    if (!online.connected) {
      lobbyStateEl.textContent = "Waiting for room connection.";
      return;
    }
    const list = Array.isArray(online.participants) ? online.participants : [];
    list.forEach((p, idx) => {
      const li = document.createElement("li");
      const left = document.createElement("span");
      const role = p && p.role === "host" ? "Host" : "Guest";
      left.textContent = normalizeName((p && p.name) || ("P" + (idx + 1))) + " (" + role + ")";
      const right = document.createElement("span");
      right.className = p && p.ready ? "ready-on" : "ready-off";
      right.textContent = p && p.ready ? "Ready" : "Not ready";
      li.appendChild(left);
      li.appendChild(right);
      lobbyListEl.appendChild(li);
    });

    if (!list.length) lobbyStateEl.textContent = "No players in room.";
    else if (!online.canStart) lobbyStateEl.textContent = "Need more ready players before round start.";
    else lobbyStateEl.textContent = "Room ready for a new round.";
  }

  function renderTable() {
    phasePillEl.textContent = game.phase === "playing" ? "Playing" : (game.phase === "results" ? "Results" : "Lobby");
    tableStatusEl.textContent = "Connect to a room and ready up.";
    if (game.phase === "playing") {
      const turnId = currentTurnId();
      if (turnId) tableStatusEl.textContent = "Turn: " + playerNameById(turnId);
      else tableStatusEl.textContent = "Resolving round...";
    } else if (game.phase === "results") {
      tableStatusEl.textContent = "Round " + game.round + " complete. Host can start next round.";
    }

    dealerCardsEl.innerHTML = "";
    const dealerCards = Array.isArray(game.dealer.cards) ? game.dealer.cards : [];
    dealerCards.forEach((card, idx) => {
      const chip = document.createElement("span");
      chip.className = "card-chip";
      if (!game.dealer.reveal && game.phase === "playing" && idx > 0) chip.textContent = "??";
      else chip.textContent = cardText(card);
      dealerCardsEl.appendChild(chip);
    });
    if (dealerCards.length === 0) {
      const chip = document.createElement("span");
      chip.className = "card-chip";
      chip.textContent = "--";
      dealerCardsEl.appendChild(chip);
    }
    if (dealerCards.length && (game.dealer.reveal || game.phase === "results")) dealerTotalEl.textContent = "Total: " + handValue(dealerCards);
    else if (dealerCards.length) dealerTotalEl.textContent = "Total: hidden";
    else dealerTotalEl.textContent = "";

    playersListEl.innerHTML = "";
    const order = Array.isArray(game.order) ? game.order : [];
    const turnId = currentTurnId();
    order.forEach((id) => {
      const item = document.createElement("li");
      item.className = "player-item";
      if (String(id) === String(turnId) && game.phase === "playing") item.classList.add("active");
      const head = document.createElement("div");
      head.className = "player-head";
      const left = document.createElement("strong");
      left.textContent = playerNameById(id) + (String(id) === String(online.clientId) ? " (You)" : "");
      const right = document.createElement("span");
      right.className = "player-meta";
      if (game.phase === "results") right.textContent = String(game.results[id] || "");
      else right.textContent = game.done[id] ? "Done" : "Playing";
      head.appendChild(left);
      head.appendChild(right);
      item.appendChild(head);

      const cardsWrap = document.createElement("div");
      cardsWrap.className = "cards";
      const cards = Array.isArray(game.hands[id]) ? game.hands[id] : [];
      cards.forEach((card) => {
        const chip = document.createElement("span");
        chip.className = "card-chip";
        chip.textContent = cardText(card);
        cardsWrap.appendChild(chip);
      });
      if (!cards.length) {
        const chip = document.createElement("span");
        chip.className = "card-chip";
        chip.textContent = "--";
        cardsWrap.appendChild(chip);
      }
      item.appendChild(cardsWrap);

      const meta = document.createElement("div");
      meta.className = "player-meta";
      const total = handValue(cards);
      meta.textContent = "Total: " + total + (isBlackjack(cards) ? " (Blackjack)" : "") + (total > 21 ? " (Bust)" : "");
      item.appendChild(meta);
      playersListEl.appendChild(item);
    });

    if (!order.length) {
      const empty = document.createElement("li");
      empty.className = "player-item";
      empty.textContent = "No active round players yet.";
      playersListEl.appendChild(empty);
    }

    const isMyTurn = game.phase === "playing" && String(turnId) === String(online.clientId);
    hitBtn.disabled = !isMyTurn;
    standBtn.disabled = !isMyTurn;
    startRoundBtn.disabled = !(online.connected && online.canStart);
  }

  function renderAll() {
    renderLobby();
    renderTable();
    updateReadyButton();
  }

  function serializeGame() {
    return {
      phase: game.phase,
      round: Number(game.round || 0),
      order: Array.isArray(game.order) ? game.order.slice() : [],
      turnIndex: Number(game.turnIndex || 0),
      dealer: { cards: Array.isArray(game.dealer.cards) ? game.dealer.cards.slice() : [], reveal: !!game.dealer.reveal },
      hands: Object.assign({}, game.hands),
      done: Object.assign({}, game.done),
      results: Object.assign({}, game.results),
      deck: Array.isArray(game.deck) ? game.deck.slice() : []
    };
  }

  function applyGameSnapshot(raw) {
    if (!raw || typeof raw !== "object") return;
    game.phase = String(raw.phase || "lobby");
    game.round = clamp(Number(raw.round || 0), 0, 99999);
    game.order = Array.isArray(raw.order) ? raw.order.map((id) => String(id)) : [];
    game.turnIndex = clamp(Number(raw.turnIndex || 0), 0, Math.max(0, game.order.length));
    const dealerCards = raw.dealer && Array.isArray(raw.dealer.cards) ? raw.dealer.cards.slice(0, 32) : [];
    game.dealer = { cards: dealerCards, reveal: !!(raw.dealer && raw.dealer.reveal) };
    game.hands = {};
    Object.keys(raw.hands || {}).forEach((id) => {
      const cards = Array.isArray(raw.hands[id]) ? raw.hands[id].slice(0, 32) : [];
      game.hands[String(id)] = cards;
    });
    game.done = {};
    Object.keys(raw.done || {}).forEach((id) => {
      game.done[String(id)] = !!raw.done[id];
    });
    game.results = {};
    Object.keys(raw.results || {}).forEach((id) => {
      game.results[String(id)] = String(raw.results[id] || "");
    });
    game.deck = Array.isArray(raw.deck) ? raw.deck.slice(0, 104) : [];
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
    if (!online.connected || online.role !== "host") return;
    sendRelay({ kind: "state_update", reason: String(reason || ""), state: serializeGame() });
  }

  function hostAdvanceTurn() {
    while (game.turnIndex < game.order.length) {
      const pid = String(game.order[game.turnIndex] || "");
      if (!game.done[pid]) break;
      game.turnIndex += 1;
    }
    if (game.turnIndex >= game.order.length) hostResolveDealer();
  }

  function hostResolveDealer() {
    game.dealer.reveal = true;
    while (handValue(game.dealer.cards) < 17) {
      game.dealer.cards.push(drawCard());
    }
    const dealerTotal = handValue(game.dealer.cards);
    const dealerBust = dealerTotal > 21;
    game.results = {};
    game.order.forEach((id) => {
      const cards = game.hands[id] || [];
      const total = handValue(cards);
      if (total > 21) game.results[id] = "Lose (Bust)";
      else if (dealerBust) game.results[id] = "Win";
      else if (total > dealerTotal) game.results[id] = "Win";
      else if (total < dealerTotal) game.results[id] = "Lose";
      else game.results[id] = "Push";
    });
    game.phase = "results";
    broadcastState("round_results");
    renderAll();
  }

  function hostStartRound() {
    if (!online.connected || online.role !== "host") return;
    const active = (online.participants || []).filter((p) => !!(p && p.ready)).map((p) => String(p.id || ""));
    if (active.length < 2) {
      renderAll();
      return;
    }
    game.phase = "playing";
    game.round += 1;
    game.order = active;
    game.turnIndex = 0;
    game.deck = buildShuffledDeck();
    game.dealer = { cards: [drawCard(), drawCard()], reveal: false };
    game.hands = {};
    game.done = {};
    game.results = {};

    active.forEach((id) => {
      game.hands[id] = [drawCard(), drawCard()];
      game.done[id] = false;
      if (isBlackjack(game.hands[id])) game.done[id] = true;
    });
    hostAdvanceTurn();
    broadcastState("round_start");
    renderAll();
  }

  function hostApplyAction(playerId, action) {
    if (game.phase !== "playing") return;
    if (String(currentTurnId()) !== String(playerId)) return;
    if (game.done[playerId]) return;

    if (action === "hit") {
      game.hands[playerId].push(drawCard());
      if (handValue(game.hands[playerId]) >= 21) {
        game.done[playerId] = true;
      }
    } else if (action === "stand") {
      game.done[playerId] = true;
    } else {
      return;
    }
    hostAdvanceTurn();
    if (game.phase === "playing") broadcastState("player_action");
    renderAll();
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
    resetRoundState();
    netState("warn", online.room ? ("Disconnected (" + online.room + ")") : "Offline");
    tableStatusEl.textContent = message || "Connect to a room and ready up.";
    renderAll();
  }

  function handleRelay(payload, senderId) {
    if (!payload || typeof payload !== "object") return;
    const kind = String(payload.kind || "");
    if (kind === "request_sync" && online.role === "host") {
      sendRelay({ kind: "state_sync", state: serializeGame() });
      return;
    }
    if ((kind === "state_update" || kind === "state_sync") && online.role !== "host") {
      applyGameSnapshot(payload.state || {});
      return;
    }
    if (kind === "start_request" && online.role === "host") {
      hostStartRound();
      return;
    }
    if (kind === "action_request" && online.role === "host") {
      const action = String(payload.action || "");
      if (action === "hit" || action === "stand") hostApplyAction(String(senderId || ""), action);
    }
  }

  function connectRoom(rawCode) {
    const code = normalizeRoomCode(rawCode);
    roomCodeEl.value = code;
    if (code.length < 4) {
      tableStatusEl.textContent = "Room code must be at least 4 characters.";
      return;
    }
    online.playerName = normalizeName(playerNameEl.value);
    playerNameEl.value = online.playerName;
    closeSocket("", true);
    online.room = code;
    netState("warn", "Connecting...");

    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch (_e) {
      netState("warn", "Socket error");
      tableStatusEl.textContent = "Could not open websocket.";
      return;
    }
    online.ws = ws;

    ws.addEventListener("open", () => {
      sendOnline({
        type: "join",
        room: code,
        password: String(roomPasswordEl.value || "").slice(0, 32),
        name: online.playerName
      });
      netState("warn", "Joining room...");
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
        tableStatusEl.textContent = String(data.message || "Room error");
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
        if (online.role === "host" && game.phase === "playing") {
          const connectedIds = new Set(online.participants.map((p) => String(p.id || "")));
          game.order = game.order.filter((id) => connectedIds.has(String(id)));
          if (game.turnIndex >= game.order.length) hostResolveDealer();
        }
        renderAll();
        return;
      }

      if (data.type === "relay") {
        handleRelay(data.payload || {}, String(data.from || ""));
      }
    });

    ws.addEventListener("close", () => {
      closeSocket("Disconnected from room.", true);
    });
    ws.addEventListener("error", () => {
      netState("warn", "Socket error");
    });
  }

  function savePlayerName() {
    online.playerName = normalizeName(playerNameEl.value);
    playerNameEl.value = online.playerName;
    try {
      window.localStorage.setItem("cartofia_blackjack_name", online.playerName);
    } catch (_e) {
      // ignore
    }
  }

  function loadPlayerName() {
    try {
      online.playerName = normalizeName(window.localStorage.getItem("cartofia_blackjack_name") || DEFAULT_NAME);
    } catch (_e) {
      online.playerName = DEFAULT_NAME;
    }
    playerNameEl.value = online.playerName;
  }

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
    const code = randomRoomCode();
    roomCodeEl.value = code;
    connectRoom(code);
  });
  joinRoomBtn.addEventListener("click", () => connectRoom(roomCodeEl.value));
  leaveRoomBtn.addEventListener("click", () => closeSocket("Left room.", false));

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

  startRoundBtn.addEventListener("click", () => {
    if (!online.connected) return;
    if (online.role === "host") hostStartRound();
    else sendRelay({ kind: "start_request" });
  });
  hitBtn.addEventListener("click", () => {
    if (!online.connected || game.phase !== "playing") return;
    if (String(currentTurnId()) !== String(online.clientId)) return;
    if (online.role === "host") hostApplyAction(online.clientId, "hit");
    else sendRelay({ kind: "action_request", action: "hit" });
  });
  standBtn.addEventListener("click", () => {
    if (!online.connected || game.phase !== "playing") return;
    if (String(currentTurnId()) !== String(online.clientId)) return;
    if (online.role === "host") hostApplyAction(online.clientId, "stand");
    else sendRelay({ kind: "action_request", action: "stand" });
  });

  setInterval(() => {
    if (online.ws && online.ws.readyState === WebSocket.OPEN) sendOnline({ type: "heartbeat" });
  }, HEARTBEAT_MS);
  window.addEventListener("beforeunload", () => closeSocket("", false));

  loadPlayerName();
  resetRoundState();
  netState("warn", "Offline");
  renderAll();
})();
