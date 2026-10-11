(() => {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const WS_URL = window.CARTOFIA_BLACKJACK_WS_URL
    || ((window.location.protocol === "https:" ? "wss://" : "ws://")
        + window.location.host + "/ws/rooms/blackjack");
  const HEARTBEAT_MS = 20000;
  const DEFAULT_NAME = "Player";
  const SUIT_ICON  = { S: "♠", H: "♥", D: "♦", C: "♣" };
  const SUIT_CLASS = { S: "black", H: "red",   D: "red",   C: "black" };
  const SUITS = ["S", "H", "D", "C"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"];
  const RANK_FACE = { T: "10" };

  const BET_MIN = 10;
  const BET_MAX = 10000;
  const BET_STEP = 10;
  const BET_DEFAULT = 100;
  const WALLET_URL  = "/api/casino/wallet";
  const TOPUP_URL   = "/api/casino/wallet/topup";
  const SETTLE_URL  = "/api/casino/blackjack/settle";
  const BET_STORAGE_KEY = "cartofia_blackjack_bet";

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const phasePillEl   = document.getElementById("phasePill");
  const tableStatusEl = document.getElementById("tableStatus");
  const dealerCardsEl = document.getElementById("dealerCards");
  const dealerTotalEl = document.getElementById("dealerTotal");
  const playersListEl = document.getElementById("playersList");
  const startRoundBtn = document.getElementById("startRoundBtn");
  const hitBtn        = document.getElementById("hitBtn");
  const standBtn      = document.getElementById("standBtn");
  const doubleBtn     = document.getElementById("doubleBtn");

  const netStatusEl   = document.getElementById("netStatus");
  const roomCodeEl    = document.getElementById("roomCode");
  const roomPasswordEl= document.getElementById("roomPassword");
  const playerNameEl  = document.getElementById("playerName");
  const createRoomBtn = document.getElementById("createRoomBtn");
  const joinRoomBtn   = document.getElementById("joinRoomBtn");
  const leaveRoomBtn  = document.getElementById("leaveRoomBtn");
  const saveNameBtn   = document.getElementById("saveNameBtn");
  const readyBtn      = document.getElementById("readyBtn");
  const lobbyStateEl  = document.getElementById("lobbyState");
  const lobbyListEl   = document.getElementById("lobbyList");

  const walletChipsEl = document.getElementById("walletChips");
  const walletStatsEl = document.getElementById("walletStats");
  const walletBannerEl= document.getElementById("walletBanner");
  const topupBtn      = document.getElementById("topupBtn");
  const betInputEl    = document.getElementById("betInput");
  const betDownBtn    = document.getElementById("betDown");
  const betUpBtn      = document.getElementById("betUp");
  const roundResultEl = document.getElementById("roundResult");

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
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
    playerName: DEFAULT_NAME,
    localBet: BET_DEFAULT
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
    bets: {},        // per-player bet staked at round start
    doubled: {},     // per-player: did they double down this round
    blackjacks: {},  // per-player: did they draw a natural (2-card 21)
    deck: []
  };
  let roundStartTime = 0;
  let lastLoggedRound = -1;
  let lastSettledRound = -1;

  // Wallet mirrored from the server. Null = not loaded / not authed.
  let wallet = null;

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function fmtChips(n) {
    const v = Number(n || 0);
    return v.toLocaleString();
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
  function clampBet(n) {
    const v = Math.round(Number(n) || 0);
    if (v < BET_MIN) return BET_MIN;
    if (v > BET_MAX) return BET_MAX;
    // snap to step
    return Math.round(v / BET_STEP) * BET_STEP;
  }
  function getAuthToken() {
    try {
      return sessionStorage.getItem("oidc_access_token")
          || localStorage.getItem("oidc_access_token")
          || "";
    } catch (_e) { return ""; }
  }
  function authedFetch(url, opts) {
    const o = Object.assign({}, opts || {});
    o.headers = Object.assign({}, o.headers || {});
    const token = getAuthToken();
    if (token) o.headers["Authorization"] = "Bearer " + token;
    if (o.body && !o.headers["Content-Type"]) o.headers["Content-Type"] = "application/json";
    return fetch(url, o);
  }

  function netState(kind, text) {
    netStatusEl.classList.remove("ok", "warn");
    if (kind === "ok" || kind === "warn") netStatusEl.classList.add(kind);
    netStatusEl.textContent = text;
  }

  function updateReadyButton() {
    readyBtn.textContent = "Ready: " + (online.localReady ? "On" : "Off");
    readyBtn.classList.toggle("btn-primary", online.localReady);
    readyBtn.classList.toggle("btn-ghost",  !online.localReady);
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

  // ---------------------------------------------------------------------------
  // Cards + hand math
  // ---------------------------------------------------------------------------
  function cardRank(card) { return String(card || "").slice(0, 1); }
  function cardSuit(card) { return String(card || "").slice(1, 2); }

  function handValue(cards) {
    let total = 0;
    let aces = 0;
    (cards || []).forEach((card) => {
      const rank = cardRank(card);
      if (rank === "A") { aces += 1; total += 11; }
      else if (rank === "T" || rank === "J" || rank === "Q" || rank === "K") total += 10;
      else total += Number(rank) || 0;
    });
    while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
    return total;
  }
  function cardValue(card) {
    const rank = cardRank(card);
    if (rank === "A") return 11;
    if (rank === "T" || rank === "J" || rank === "Q" || rank === "K") return 10;
    return Number(rank) || 0;
  }
  function isBlackjack(cards) {
    return Array.isArray(cards) && cards.length === 2 && handValue(cards) === 21;
  }
  function buildShuffledDeck() {
    const deck = [];
    SUITS.forEach((s) => RANKS.forEach((r) => deck.push(r + s)));
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
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
    game.bets = {};
    game.doubled = {};
    game.blackjacks = {};
  }

  // ---------------------------------------------------------------------------
  // Card face rendering — casino look
  // ---------------------------------------------------------------------------
  function buildCard(card, opts) {
    const faceDown = !!(opts && opts.faceDown);
    const fresh    = !!(opts && opts.fresh);
    const el = document.createElement("span");
    el.className = "pcard";
    if (fresh) el.classList.add("pcard-fresh");
    if (faceDown) {
      el.classList.add("pcard-back");
      el.setAttribute("aria-label", "Hidden card");
      return el;
    }
    const rank = cardRank(card);
    const suit = cardSuit(card);
    const face = RANK_FACE[rank] || rank;
    const icon = SUIT_ICON[suit] || "?";
    const col  = SUIT_CLASS[suit] || "black";
    el.classList.add("pcard-" + col);
    el.setAttribute("aria-label", face + " of " + ({S:"spades",H:"hearts",D:"diamonds",C:"clubs"}[suit] || suit));
    el.innerHTML =
      '<span class="pcard-corner tl">' + face + '<span class="pcard-suit">' + icon + '</span></span>' +
      '<span class="pcard-pip">' + icon + '</span>' +
      '<span class="pcard-corner br">' + face + '<span class="pcard-suit">' + icon + '</span></span>';
    return el;
  }

  function renderCardsInto(container, cards, opts) {
    const prevCount = (container.__renderedCount || 0);
    container.innerHTML = "";
    container.__renderedCount = (cards || []).length;
    const hideHoleCard = !!(opts && opts.hideHoleCard);
    (cards || []).forEach((card, idx) => {
      const faceDown = hideHoleCard && idx > 0;
      const fresh = idx >= prevCount; // only animate newly-dealt cards
      container.appendChild(buildCard(card, { faceDown, fresh }));
    });
    if (!cards || !cards.length) {
      const slot = document.createElement("span");
      slot.className = "pcard pcard-empty";
      slot.textContent = "";
      container.appendChild(slot);
    }
  }

  // ---------------------------------------------------------------------------
  // Lobby render
  // ---------------------------------------------------------------------------
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
      const nm = normalizeName((p && p.name) || ("P" + (idx + 1)));
      left.textContent = nm + " (" + role + ")";
      const right = document.createElement("span");
      right.className = p && p.ready ? "ready-on" : "ready-off";
      right.textContent = p && p.ready ? "Ready" : "Not ready";
      li.appendChild(left);
      li.appendChild(right);
      lobbyListEl.appendChild(li);
    });

    if (!list.length) {
      lobbyStateEl.textContent = "No players in room.";
    } else if (!online.canStart) {
      lobbyStateEl.textContent = "Waiting for players to ready up.";
    } else {
      const nReady = list.filter((p) => p && p.ready).length;
      if (nReady === 1) lobbyStateEl.textContent = "Solo table ready — press Start Round.";
      else lobbyStateEl.textContent = nReady + " players ready — press Start Round.";
    }
  }

  // ---------------------------------------------------------------------------
  // Table render
  // ---------------------------------------------------------------------------
  function phaseText() {
    if (game.phase === "playing") return "Playing";
    if (game.phase === "results") return "Results";
    return "Lobby";
  }
  function statusText() {
    if (!online.connected) return "Connect to a table and ready up.";
    if (game.phase === "playing") {
      const turnId = currentTurnId();
      if (!turnId) return "Resolving round…";
      if (String(turnId) === String(online.clientId)) return "Your turn — hit, stand, or double.";
      return "Waiting on " + playerNameById(turnId) + "…";
    }
    if (game.phase === "results") return "Round " + game.round + " complete. Host can start the next round.";
    // lobby, connected
    if (!online.canStart) return "Place your bet and ready up when you want to play.";
    return "Ready — host can start the round.";
  }

  function renderTable() {
    phasePillEl.textContent = phaseText();
    tableStatusEl.textContent = statusText();

    // Dealer zone
    const dealerCards = Array.isArray(game.dealer.cards) ? game.dealer.cards : [];
    const hideHole = (!game.dealer.reveal && game.phase === "playing");
    renderCardsInto(dealerCardsEl, dealerCards, { hideHoleCard: hideHole });
    if (dealerCards.length) {
      if (game.dealer.reveal || game.phase === "results") {
        dealerTotalEl.textContent = "Total: " + handValue(dealerCards);
      } else {
        // Show just the up-card's value so players can plan
        const up = dealerCards[0];
        const upVal = cardValue(up);
        dealerTotalEl.textContent = "Showing: " + (upVal === 11 ? "A (soft 11)" : String(upVal));
      }
    } else {
      dealerTotalEl.textContent = "";
    }

    // Player seats
    playersListEl.innerHTML = "";
    const order = Array.isArray(game.order) ? game.order : [];
    const turnId = currentTurnId();
    order.forEach((id) => {
      const item = document.createElement("li");
      item.className = "player-item";
      const isActive = (String(id) === String(turnId) && game.phase === "playing");
      if (isActive) item.classList.add("active");

      const head = document.createElement("div");
      head.className = "player-head";
      const left = document.createElement("strong");
      left.className = "player-name-label";
      left.textContent = playerNameById(id) + (String(id) === String(online.clientId) ? " (You)" : "");
      const right = document.createElement("span");
      right.className = "player-meta";
      const bet = Number(game.bets[id] || 0);
      const dbl = !!game.doubled[id];
      if (game.phase === "results") {
        right.textContent = String(game.results[id] || "");
        right.classList.add("player-result");
      } else if (bet > 0) {
        right.textContent = (dbl ? "Bet " + fmtChips(bet) + " ×2" : "Bet " + fmtChips(bet));
      } else {
        right.textContent = game.done[id] ? "Done" : "Playing";
      }
      head.appendChild(left);
      head.appendChild(right);
      item.appendChild(head);

      const cardsWrap = document.createElement("div");
      cardsWrap.className = "cards";
      const cards = Array.isArray(game.hands[id]) ? game.hands[id] : [];
      renderCardsInto(cardsWrap, cards, {});
      item.appendChild(cardsWrap);

      const meta = document.createElement("div");
      meta.className = "player-meta";
      const total = handValue(cards);
      const tags = [];
      tags.push("Total " + total);
      if (isBlackjack(cards) || game.blackjacks[id]) tags.push("Blackjack");
      if (total > 21) tags.push("Bust");
      if (game.done[id] && !game.blackjacks[id] && total <= 21 && !cards.length === false) tags.push("Stand");
      meta.textContent = tags.join(" · ");
      item.appendChild(meta);
      playersListEl.appendChild(item);
    });

    if (!order.length) {
      const empty = document.createElement("li");
      empty.className = "player-item player-item-empty";
      empty.textContent = "No active round players yet.";
      playersListEl.appendChild(empty);
    }

    // Action buttons
    const isMyTurn = game.phase === "playing" && String(turnId) === String(online.clientId);
    const myCards  = isMyTurn ? (game.hands[online.clientId] || []) : [];
    const myBet    = Number(game.bets[online.clientId] || 0);
    const chips    = wallet ? Number(wallet.chips) : 0;
    const canAct   = isMyTurn && !game.done[online.clientId];
    const canDouble = canAct && myCards.length === 2 && (!wallet || chips >= myBet);

    hitBtn.disabled    = !canAct;
    standBtn.disabled  = !canAct;
    if (doubleBtn) doubleBtn.disabled = !canDouble;
    startRoundBtn.disabled = !(online.connected && online.canStart && game.phase !== "playing");
  }

  // ---------------------------------------------------------------------------
  // Wallet UI
  // ---------------------------------------------------------------------------
  function renderWallet() {
    if (!walletChipsEl) return;
    if (!wallet) {
      walletChipsEl.textContent = "—";
      if (walletStatsEl) walletStatsEl.textContent = "Sign in to play for chips.";
      if (topupBtn) topupBtn.hidden = true;
      if (walletBannerEl) walletBannerEl.hidden = true;
      return;
    }
    walletChipsEl.textContent = fmtChips(wallet.chips);
    if (walletStatsEl) {
      const won = Number(wallet.hands_won || 0);
      const played = Number(wallet.hands_played || 0);
      const wr = played ? Math.round((won / played) * 100) : 0;
      walletStatsEl.textContent =
        played + " hands · " + won + " won (" + wr + "%) · net " + fmtChips(wallet.net_lifetime);
    }
    const broke = wallet.chips < 100;
    if (topupBtn) topupBtn.hidden = !broke;
    if (walletBannerEl) {
      if (broke) {
        walletBannerEl.hidden = false;
        walletBannerEl.textContent = "You are below " + fmtChips(100) + " chips — claim a free top-up.";
      } else {
        walletBannerEl.hidden = true;
      }
    }
  }

  function renderBetInput() {
    if (!betInputEl) return;
    betInputEl.value = String(online.localBet);
    const chips = wallet ? Number(wallet.chips) : Infinity;
    if (betDownBtn) betDownBtn.disabled = online.localBet <= BET_MIN;
    if (betUpBtn)   betUpBtn.disabled   = online.localBet >= BET_MAX || online.localBet + BET_STEP > chips;
  }

  let _lastLoggedPhase = "";
  function logIfRoundComplete() {
    if (game.phase !== "results") return;
    const key = "results-" + game.round;
    if (_lastLoggedPhase === key || !online.clientId) return;
    _lastLoggedPhase = key;
    lastLoggedRound = game.round;
    const myResult = game.results[online.clientId] || "unknown";
    const dur = roundStartTime ? Math.round((Date.now() - roundStartTime) / 1000) : 0;
    if (typeof window.logGameActivity === "function") {
      window.logGameActivity({ game: "blackjack", result: myResult, round: game.round, duration_seconds: dur });
    }
  }

  function renderAll() {
    maybeSettleMyHand();
    renderLobby();
    renderTable();
    renderWallet();
    renderBetInput();
    updateReadyButton();
    logIfRoundComplete();
  }

  // ---------------------------------------------------------------------------
  // Wallet + settle API
  // ---------------------------------------------------------------------------
  function loadWallet() {
    if (!getAuthToken()) {
      wallet = null;
      renderWallet();
      return;
    }
    authedFetch(WALLET_URL)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j && j.wallet) {
          wallet = j.wallet;
          // If server returned chips < local bet, trim
          if (online.localBet > wallet.chips) {
            online.localBet = Math.max(BET_MIN, clampBet(wallet.chips));
          }
        } else {
          wallet = null;
        }
        renderWallet();
        renderBetInput();
      })
      .catch(() => { wallet = null; renderWallet(); });
  }

  function requestTopup() {
    if (!getAuthToken()) return;
    authedFetch(TOPUP_URL, { method: "POST" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, body: j })))
      .then(({ ok, body }) => {
        if (ok && body && body.wallet) {
          wallet = body.wallet;
          showRoundResult("+" + fmtChips(body.delta) + " chips topped up", "ok");
        } else if (body && body.reason) {
          showRoundResult(body.reason, "warn");
          if (body.wallet) wallet = body.wallet;
        }
        renderWallet();
      })
      .catch(() => {});
  }

  function showRoundResult(text, kind) {
    if (!roundResultEl) return;
    roundResultEl.textContent = text || "";
    roundResultEl.classList.remove("win", "lose", "push", "warn", "ok");
    if (kind) roundResultEl.classList.add(kind);
    roundResultEl.hidden = !text;
  }

  function maybeSettleMyHand() {
    if (game.phase !== "results") return;
    if (!online.clientId) return;
    if (lastSettledRound === game.round) return;
    const result = String(game.results[online.clientId] || "");
    if (!result) return;
    lastSettledRound = game.round;

    const outcome = resultToOutcome(result);
    const myBet = Number(game.bets[online.clientId] || online.localBet);
    const doubled = !!game.doubled[online.clientId];

    // Show round banner immediately with a local estimate; actual delta from server.
    const localDelta = estimateDelta(outcome, myBet, doubled);
    const kind = localDelta > 0 ? "win" : (localDelta < 0 ? "lose" : "push");
    const sign = localDelta > 0 ? "+" : "";
    showRoundResult(result + " — " + sign + fmtChips(localDelta) + " chips", kind);

    if (!getAuthToken()) return;
    authedFetch(SETTLE_URL, {
      method: "POST",
      body: JSON.stringify({ bet: myBet, outcome, doubled })
    })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        if (j && j.wallet) {
          wallet = j.wallet;
          const delta = Number(j.delta || 0);
          const k = delta > 0 ? "win" : (delta < 0 ? "lose" : "push");
          const s = delta > 0 ? "+" : "";
          showRoundResult(result + " — " + s + fmtChips(delta) + " chips", k);
          renderWallet();
          renderBetInput();
        }
      })
      .catch(() => {});
  }

  function resultToOutcome(resultText) {
    const s = String(resultText || "").toLowerCase();
    if (s.indexOf("blackjack") >= 0) return "blackjack";
    if (s.indexOf("push") >= 0) return "push";
    if (s.indexOf("win") >= 0) return "win";
    return "lose";
  }
  function estimateDelta(outcome, bet, doubled) {
    const stake = doubled ? bet * 2 : bet;
    if (outcome === "blackjack") return Math.floor(bet * 1.5);
    if (outcome === "win")       return stake;
    if (outcome === "push")      return 0;
    return -stake;
  }

  // ---------------------------------------------------------------------------
  // Snapshot + relay
  // ---------------------------------------------------------------------------
  function serializeGame() {
    return {
      phase: game.phase,
      round: Number(game.round || 0),
      order: Array.isArray(game.order) ? game.order.slice() : [],
      turnIndex: Number(game.turnIndex || 0),
      dealer: {
        cards: Array.isArray(game.dealer.cards) ? game.dealer.cards.slice() : [],
        reveal: !!game.dealer.reveal
      },
      hands: Object.assign({}, game.hands),
      done: Object.assign({}, game.done),
      results: Object.assign({}, game.results),
      bets: Object.assign({}, game.bets),
      doubled: Object.assign({}, game.doubled),
      blackjacks: Object.assign({}, game.blackjacks),
      deck: Array.isArray(game.deck) ? game.deck.slice() : []
    };
  }

  function applyGameSnapshot(raw) {
    if (!raw || typeof raw !== "object") return;
    const prevPhase = game.phase;
    game.phase = String(raw.phase || "lobby");
    if (game.phase === "playing" && prevPhase !== "playing") {
      roundStartTime = Date.now();
      showRoundResult("", null);
    }
    if (prevPhase !== "results" && game.phase === "results") {
      // New results — reset settle gate
      // (handled by comparing game.round to lastSettledRound)
    }
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
    Object.keys(raw.done || {}).forEach((id) => { game.done[String(id)] = !!raw.done[id]; });
    game.results = {};
    Object.keys(raw.results || {}).forEach((id) => { game.results[String(id)] = String(raw.results[id] || ""); });
    game.bets = {};
    Object.keys(raw.bets || {}).forEach((id) => {
      const n = Math.max(0, Math.round(Number(raw.bets[id]) || 0));
      game.bets[String(id)] = n;
    });
    game.doubled = {};
    Object.keys(raw.doubled || {}).forEach((id) => { game.doubled[String(id)] = !!raw.doubled[id]; });
    game.blackjacks = {};
    Object.keys(raw.blackjacks || {}).forEach((id) => { game.blackjacks[String(id)] = !!raw.blackjacks[id]; });
    game.deck = Array.isArray(raw.deck) ? raw.deck.slice(0, 104) : [];
    renderAll();
  }

  function sendOnline(payload) {
    if (!online.ws || online.ws.readyState !== WebSocket.OPEN) return false;
    try { online.ws.send(JSON.stringify(payload)); return true; }
    catch (_e) { return false; }
  }
  function sendRelay(payload) { return sendOnline(payload || {}); }
  function sendLobby(payload) { return sendOnline(Object.assign({ type: "lobby" }, payload || {})); }

  function broadcastState(reason) {
    if (!online.connected || online.role !== "host") return;
    sendRelay({ kind: "state_update", reason: String(reason || ""), state: serializeGame() });
  }

  // ---------------------------------------------------------------------------
  // Host logic
  // ---------------------------------------------------------------------------
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
    // If every player busted or got blackjack, dealer still plays per rule.
    while (handValue(game.dealer.cards) < 17) {
      game.dealer.cards.push(drawCard());
    }
    const dealerTotal = handValue(game.dealer.cards);
    const dealerBust  = dealerTotal > 21;
    const dealerBJ    = isBlackjack(game.dealer.cards);
    game.results = {};
    game.order.forEach((id) => {
      const cards = game.hands[id] || [];
      const total = handValue(cards);
      const pbj   = !!game.blackjacks[id];
      if (pbj && dealerBJ)       game.results[id] = "Push (both Blackjack)";
      else if (pbj)              game.results[id] = "Blackjack! (3:2)";
      else if (dealerBJ)         game.results[id] = "Lose (Dealer Blackjack)";
      else if (total > 21)       game.results[id] = "Lose (Bust)";
      else if (dealerBust)       game.results[id] = "Win (Dealer bust)";
      else if (total > dealerTotal) game.results[id] = "Win";
      else if (total < dealerTotal) game.results[id] = "Lose";
      else                       game.results[id] = "Push";
    });
    game.phase = "results";
    broadcastState("round_results");
    renderAll();
  }

  function hostStartRound() {
    if (!online.connected || online.role !== "host") return;
    const participants = online.participants || [];
    const active = participants
      .filter((p) => !!(p && p.ready))
      .map((p) => String(p.id || ""));
    if (active.length < 1) { renderAll(); return; }

    // Capture each player's declared bet from the lobby map (defaults to BET_DEFAULT).
    const bets = {};
    participants.forEach((p) => {
      if (!p || !p.ready) return;
      const b = clampBet(Number(p.bet) || BET_DEFAULT);
      bets[String(p.id)] = b;
    });

    game.phase = "playing";
    game.round += 1;
    roundStartTime = Date.now();
    game.order = active;
    game.turnIndex = 0;
    game.deck = buildShuffledDeck();
    game.dealer = { cards: [drawCard(), drawCard()], reveal: false };
    game.hands = {};
    game.done = {};
    game.results = {};
    game.bets = bets;
    game.doubled = {};
    game.blackjacks = {};

    active.forEach((id) => {
      game.hands[id] = [drawCard(), drawCard()];
      game.done[id] = false;
      if (isBlackjack(game.hands[id])) {
        game.done[id] = true;
        game.blackjacks[id] = true;
      }
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
      if (handValue(game.hands[playerId]) >= 21) game.done[playerId] = true;
    } else if (action === "stand") {
      game.done[playerId] = true;
    } else if (action === "double") {
      // Must have exactly 2 cards; add exactly one and auto-stand.
      if (!Array.isArray(game.hands[playerId]) || game.hands[playerId].length !== 2) return;
      game.doubled[playerId] = true;
      game.hands[playerId].push(drawCard());
      game.done[playerId] = true;
    } else {
      return;
    }
    hostAdvanceTurn();
    if (game.phase === "playing") broadcastState("player_action");
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Socket plumbing
  // ---------------------------------------------------------------------------
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
      } catch (_e) {}
    }
    online.ws = null;
    setDisconnected();
    if (!keepRoom) online.room = "";
    resetRoundState();
    netState("warn", online.room ? ("Disconnected (" + online.room + ")") : "Offline");
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
      if (action === "hit" || action === "stand" || action === "double") {
        hostApplyAction(String(senderId || ""), action);
      }
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
    netState("warn", "Connecting…");

    let ws;
    try { ws = new WebSocket(WS_URL); }
    catch (_e) {
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
      netState("warn", "Joining room…");
    });

    ws.addEventListener("message", (event) => {
      let data = null;
      try { data = JSON.parse(event.data); } catch (_e) { return; }
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
        sendLobby({ name: online.playerName, ready: online.localReady, bet: online.localBet });
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
      if (data.type === "relay") handleRelay(data.payload || {}, String(data.from || ""));
    });

    ws.addEventListener("close", () => { closeSocket("Disconnected from room.", true); });
    ws.addEventListener("error", () => { netState("warn", "Socket error"); });
  }

  // ---------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------
  function savePlayerName() {
    online.playerName = normalizeName(playerNameEl.value);
    playerNameEl.value = online.playerName;
    try { window.localStorage.setItem("cartofia_blackjack_name", online.playerName); }
    catch (_e) {}
  }
  function loadPlayerName() {
    try {
      online.playerName = normalizeName(window.localStorage.getItem("cartofia_blackjack_name") || DEFAULT_NAME);
    } catch (_e) { online.playerName = DEFAULT_NAME; }
    playerNameEl.value = online.playerName;
  }
  function saveBet() {
    try { window.localStorage.setItem(BET_STORAGE_KEY, String(online.localBet)); } catch (_e) {}
  }
  function loadBet() {
    try {
      const raw = window.localStorage.getItem(BET_STORAGE_KEY);
      if (raw) online.localBet = clampBet(Number(raw) || BET_DEFAULT);
    } catch (_e) { online.localBet = BET_DEFAULT; }
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------
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
  joinRoomBtn.addEventListener("click",  () => connectRoom(roomCodeEl.value));
  leaveRoomBtn.addEventListener("click", () => closeSocket("Left room.", false));

  saveNameBtn.addEventListener("click", () => {
    savePlayerName();
    if (online.connected) sendLobby({ name: online.playerName });
  });
  readyBtn.addEventListener("click", () => {
    if (!online.connected) return;
    online.localReady = !online.localReady;
    updateReadyButton();
    sendLobby({ ready: online.localReady, bet: online.localBet });
  });

  startRoundBtn.addEventListener("click", () => {
    if (!online.connected) return;
    if (online.role === "host") hostStartRound();
    else sendRelay({ kind: "start_request" });
  });

  function sendAction(action) {
    if (!online.connected || game.phase !== "playing") return;
    if (String(currentTurnId()) !== String(online.clientId)) return;
    if (online.role === "host") hostApplyAction(online.clientId, action);
    else sendRelay({ kind: "action_request", action });
  }
  hitBtn.addEventListener("click",   () => sendAction("hit"));
  standBtn.addEventListener("click", () => sendAction("stand"));
  if (doubleBtn) doubleBtn.addEventListener("click", () => sendAction("double"));

  // Bet controls
  function applyBet(nextRaw) {
    const chips = wallet ? Number(wallet.chips) : Infinity;
    let next = clampBet(nextRaw);
    if (next > chips) next = clampBet(chips);
    if (next < BET_MIN) next = BET_MIN;
    online.localBet = next;
    saveBet();
    renderBetInput();
    if (online.connected) sendLobby({ bet: online.localBet });
  }
  if (betInputEl) {
    betInputEl.addEventListener("change", () => applyBet(betInputEl.value));
    betInputEl.addEventListener("blur",   () => applyBet(betInputEl.value));
  }
  if (betDownBtn) betDownBtn.addEventListener("click", () => applyBet(online.localBet - BET_STEP));
  if (betUpBtn)   betUpBtn.addEventListener("click",   () => applyBet(online.localBet + BET_STEP));
  if (topupBtn)   topupBtn.addEventListener("click",   requestTopup);

  // Heartbeat + unload
  setInterval(() => {
    if (online.ws && online.ws.readyState === WebSocket.OPEN) sendOnline({ type: "heartbeat" });
  }, HEARTBEAT_MS);
  window.addEventListener("beforeunload", () => closeSocket("", false));

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  loadPlayerName();
  loadBet();
  resetRoundState();
  netState("warn", "Offline");
  loadWallet();
  renderAll();
})();
