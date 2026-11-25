(() => {
  "use strict";
  // ---------------------------------------------------------------------------
  // Cartofia Blackjack — thin client over the server-authoritative table.
  //
  // The table server (/ws/rooms/blackjack, Docs/BLACKJACK-SERVER-SPEC.md)
  // shuffles, deals, runs the turns, plays the dealer, escrows and pays the
  // chips and records the arcade result. This file only sends intents
  // (create / join / bet / ready / start / action / leave) and renders the
  // `state` the server sends, through the table art in render.js (BJArt).
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const WS_URL = window.CARTOFIA_BLACKJACK_WS_URL
    || ((window.location.protocol === "https:" ? "wss://" : "ws://")
        + window.location.host + "/ws/rooms/blackjack");
  const HEARTBEAT_MS = 20000;

  const BET_MIN = 10;
  const BET_MAX = 10000;
  const BET_STEP = 10;
  const BET_DEFAULT = 100;
  const BROKE_BELOW = 100;
  const AUTH_ME_URL = "/api/auth/me";
  const WALLET_URL  = "/api/casino/wallet";
  const TOPUP_URL   = "/api/casino/wallet/topup";
  const BET_STORAGE_KEY   = "cartofia_blackjack_bet";
  const TABLE_STORAGE_KEY = "cartofia_blackjack_table"; // sessionStorage: table to rejoin after a reload
  const PHASES = ["lobby", "playing", "dealer", "results"];
  // Stand-in code for the face-down hole card. The server never sends the hole
  // card before the reveal; the renderer only ever draws this one face down.
  const HOLE = "XX";

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const phasePillEl   = document.getElementById("phasePill");
  const tableStatusEl = document.getElementById("tableStatus");
  const dealerCardsEl = document.getElementById("dealerCards");
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
  const backLinkEl    = document.querySelector(".game-header-back");

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const net = {
    ws: null,
    manualClose: false,
    attempt: 0,           // reconnect attempts since the last good `room`
    retryTimer: 0,
    dropTimer: 0          // closes a socket that got an error and never a room
  };

  const online = {
    connected: false,     // inside a room (got `room` from the server)
    room: "",
    wantRoom: "",         // room to (re)join if the socket drops
    password: "",         // password of that room, in memory only
    pendingPassword: "",
    localBet: BET_DEFAULT, // the bet the player wants; mirrored to the seat
    betSent: null,        // last bet we asked the server for (avoids resend loops)
    busy: false,          // start / action in flight: wait for the next state
    busyTimer: 0
  };

  // Mirror of the server's `state`, in the shape the view builder reads.
  const game = {
    phase: "lobby",
    round: 0,
    host: "",
    you: "",
    seats: [],            // [{id, name, ready, bet, connected, playing}]
    order: [],
    turn: "",
    turnDeadline: 0,
    dealer: { cards: [], hidden: false, reveal: false, total: 0 },
    hands: {},
    totals: {},
    done: {},
    results: {},
    payouts: {},
    bets: {},             // per-seat stake of the current round
    doubled: {},
    blackjacks: {}
  };
  const roundBets = { round: -1, bets: {} };

  // Wallet mirrored from the server. Null = not loaded / not signed in.
  let wallet = null;
  let flash = { text: "", until: 0 };
  let bannerRound = -1;
  let statsRound = -1;
  let lastView = null;
  let feltDefer = { timer: 0, since: 0 };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function fmtChips(n) { return Number(n || 0).toLocaleString(); }
  function normalizeRoomCode(raw) {
    return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }
  function clampBet(n) {
    const v = Math.round(Number(n) || 0);
    if (v < BET_MIN) return BET_MIN;
    if (v > BET_MAX) return BET_MAX;
    return Math.round(v / BET_STEP) * BET_STEP;
  }
  function floorBet(chips) {
    return Math.max(BET_MIN, Math.min(BET_MAX, Math.floor(Number(chips || 0) / BET_STEP) * BET_STEP));
  }
  function getAuthToken() {
    try {
      return sessionStorage.getItem("oidc_access_token")
          || localStorage.getItem("oidc_access_token")
          || "";
    } catch (_e) { return ""; }
  }
  function authedFetch(url, opts) {
    const o = Object.assign({ credentials: "include" }, opts || {});
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

  function setFlash(text, ms) {
    const dur = ms || 4000;
    flash = { text: String(text || ""), until: Date.now() + dur };
    renderStatus();
    setTimeout(renderStatus, dur + 50);
  }

  function seatById(id) {
    const key = String(id || "");
    return game.seats.find((s) => s.id === key) || null;
  }
  function mySeat() { return game.you ? seatById(game.you) : null; }
  function isHost() { return !!game.you && game.you === game.host; }
  function nameOf(id) {
    const s = seatById(id);
    return (s && s.name) || "Player";
  }
  function betweenRounds() { return game.phase === "lobby" || game.phase === "results"; }
  function inRound() { return game.phase === "playing" || game.phase === "dealer"; }

  // Chips the player can put on the next hand: the wallet, plus whatever is
  // escrowed on the felt right now (it comes back or goes at results).
  function availableChips() {
    if (!wallet) return Infinity;
    let c = Number(wallet.chips) || 0;
    if (inRound() && game.you && game.order.indexOf(game.you) >= 0) {
      c += Number(game.bets[game.you] || 0) * (game.doubled[game.you] ? 2 : 1);
    }
    return c;
  }
  function trimBetToWallet() {
    const cap = availableChips();
    if (online.localBet > cap) online.localBet = floorBet(cap);
  }

  // ---------------------------------------------------------------------------
  // Cards (display only: totals come from the server, these are fallbacks)
  // ---------------------------------------------------------------------------
  function cardRank(card) { return String(card || "").slice(0, 1); }
  function cardValue(card) {
    const rank = cardRank(card);
    if (rank === "A") return 11;
    if (rank === "T" || rank === "J" || rank === "Q" || rank === "K") return 10;
    return Number(rank) || 0;
  }
  function handValue(cards) {
    let total = 0, aces = 0;
    (cards || []).forEach((card) => {
      if (cardRank(card) === "A") aces += 1;
      total += cardValue(card);
    });
    while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
    return total;
  }
  function isSoftHand(cards) {
    let hard = 0, aces = 0;
    (cards || []).forEach((card) => {
      if (cardRank(card) === "A") { aces += 1; hard += 1; }
      else hard += cardValue(card);
    });
    return aces > 0 && hard + 10 <= 21;
  }
  function isBlackjack(cards) {
    return Array.isArray(cards) && cards.length === 2 && handValue(cards) === 21;
  }
  function resultToOutcome(resultText) {
    const s = String(resultText || "").toLowerCase();
    // "Lose (Dealer Blackjack)" and "Push (both Blackjack)" mention blackjack
    // but are not a 3:2 win.
    if (s.startsWith("lose")) return "lose";
    if (s.startsWith("push")) return "push";
    if (s.indexOf("blackjack") >= 0) return "blackjack";
    if (s.indexOf("win") >= 0) return "win";
    return "lose";
  }

  // ---------------------------------------------------------------------------
  // Server state -> game mirror
  // ---------------------------------------------------------------------------
  function idOrEmpty(v) { return v == null ? "" : String(v); }
  function mapOf(obj, fn) {
    const out = {};
    if (obj && typeof obj === "object") Object.keys(obj).forEach((k) => { out[String(k)] = fn(obj[k]); });
    return out;
  }
  function cardList(v) { return Array.isArray(v) ? v.slice(0, 32).map(String) : []; }

  function resetGame() {
    game.phase = "lobby";
    game.round = 0;
    game.host = "";
    game.you = "";
    game.seats = [];
    game.order = [];
    game.turn = "";
    game.turnDeadline = 0;
    game.dealer = { cards: [], hidden: false, reveal: false, total: 0 };
    game.hands = {};
    game.totals = {};
    game.done = {};
    game.results = {};
    game.payouts = {};
    game.bets = {};
    game.doubled = {};
    game.blackjacks = {};
    roundBets.round = -1;
    roundBets.bets = {};
  }

  function mirrorState(st) {
    game.phase = PHASES.indexOf(st.phase) >= 0 ? st.phase : "lobby";
    game.round = Math.max(0, Math.round(Number(st.round) || 0));
    game.host = idOrEmpty(st.host);
    game.you = idOrEmpty(st.you);
    game.seats = (Array.isArray(st.seats) ? st.seats : []).slice(0, 12).map((s) => ({
      id: idOrEmpty(s && s.id),
      name: String((s && s.name) || "Player").slice(0, 32),
      ready: !!(s && s.ready),
      bet: Math.max(0, Math.round(Number(s && s.bet) || 0)),
      connected: !(s && s.connected === false),
      playing: !!(s && s.playing)
    }));
    game.order = Array.isArray(st.order) ? st.order.map(idOrEmpty) : [];
    game.turn = idOrEmpty(st.turn);
    game.turnDeadline = Number(st.turn_deadline) || 0;
    const d = st.dealer || {};
    const dCards = cardList(d.cards);
    const dTotal = Number(d.total);
    game.dealer = {
      cards: dCards,
      hidden: !!d.hidden,
      reveal: !d.hidden,
      total: Number.isFinite(dTotal) ? dTotal : handValue(dCards)
    };
    game.hands = mapOf(st.hands, cardList);
    game.totals = mapOf(st.totals, (v) => ({ total: Math.round(Number(v && v.total) || 0), soft: !!(v && v.soft) }));
    game.done = mapOf(st.done, Boolean);
    game.doubled = mapOf(st.doubled, Boolean);
    game.blackjacks = mapOf(st.blackjacks, Boolean);
    game.results = mapOf(st.results, (v) => String(v || ""));
    game.payouts = mapOf(st.payouts, (v) => Math.round(Number(v) || 0));

    // The stake on the felt is the seat's bet as it stood when the round was
    // dealt; a seat may already change its bet for the next hand at results.
    if (st.bets && typeof st.bets === "object") {
      game.bets = mapOf(st.bets, (v) => Math.max(0, Math.round(Number(v) || 0)));
    } else {
      if (roundBets.round !== game.round) { roundBets.round = game.round; roundBets.bets = {}; }
      if (game.phase !== "lobby") {
        game.seats.forEach((s) => {
          if (game.order.indexOf(s.id) >= 0 && !(s.id in roundBets.bets)) roundBets.bets[s.id] = s.bet;
        });
      }
      game.bets = roundBets.bets;
    }

    if (st.wallet && typeof st.wallet === "object") wallet = st.wallet;
  }

  // Keep the seat's bet in step with the stepper (only allowed between rounds).
  function syncBet() {
    const me = mySeat();
    if (!me || !online.connected || !betweenRounds()) return;
    if (me.bet === online.localBet) { online.betSent = null; return; }
    if (online.betSent === online.localBet) return; // asked already; server said no
    if (send({ type: "bet", amount: online.localBet })) online.betSent = online.localBet;
  }

  // ---------------------------------------------------------------------------
  // Lobby render
  // ---------------------------------------------------------------------------
  function renderLobby() {
    lobbyListEl.textContent = "";
    if (!online.connected) {
      if (online.wantRoom) lobbyStateEl.textContent = "Reconnecting to table " + online.wantRoom + "…";
      else if (net.ws) lobbyStateEl.textContent = "Connecting to the table…";
      else lobbyStateEl.textContent = "Waiting for room connection.";
      return;
    }
    game.seats.forEach((p) => {
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.textContent = p.name + (p.id === game.host ? " (Host)" : "")
        + (p.id === game.you ? " · You" : "") + " · bet " + fmtChips(p.bet);
      const right = document.createElement("span");
      let on, txt;
      if (!p.connected) { on = false; txt = "Away"; }
      else if (inRound()) { on = p.playing; txt = p.playing ? "In hand" : "Sitting out"; }
      else { on = p.ready; txt = p.ready ? "Ready" : "Not ready"; }
      right.className = on ? "ready-on" : "ready-off";
      right.textContent = txt;
      li.appendChild(left);
      li.appendChild(right);
      lobbyListEl.appendChild(li);
    });

    const me = mySeat();
    if (!me) {
      lobbyStateEl.textContent = wallet
        ? "Watching — every seat at this table is taken."
        : "Watching — sign in to take a seat and play for chips.";
    } else if (inRound()) {
      if (me.playing) lobbyStateEl.textContent = "Round " + game.round + " in play.";
      else lobbyStateEl.textContent = "Sitting this round out" + (wallet && Number(wallet.chips) < me.bet ? " — not enough chips for your bet." : ".");
    } else if (isHost()) {
      const n = game.seats.filter((p) => p.connected && (p.ready || p.id === game.host)).length;
      lobbyStateEl.textContent = n <= 1 ? "Solo table ready — press Start Round." : n + " players ready — press Start Round.";
    } else {
      lobbyStateEl.textContent = me.ready ? "You're in — waiting for the host to start." : "Ready up to be dealt into the next round.";
    }
  }

  // ---------------------------------------------------------------------------
  // Status line + phase pill
  // ---------------------------------------------------------------------------
  function phaseText() {
    if (inRound()) return "Playing";
    if (game.phase === "results") return "Results";
    return "Lobby";
  }
  function turnSecondsLeft() {
    if (!game.turnDeadline) return null;
    return Math.max(0, Math.min(99, Math.ceil((game.turnDeadline - Date.now()) / 1000)));
  }
  function statusText() {
    if (flash.text && Date.now() < flash.until) return flash.text;
    if (!online.connected) {
      if (online.wantRoom) return "Connection lost — reconnecting…";
      if (net.ws) return "Connecting…";
      return "Connect to a table and ready up.";
    }
    if (game.phase === "playing") {
      if (!game.turn) return "Dealing…";
      const secs = turnSecondsLeft();
      const tail = secs == null ? "" : " (" + secs + "s)";
      if (game.turn === game.you) return "Your turn — hit, stand, or double." + tail;
      return "Waiting on " + nameOf(game.turn) + "…" + tail;
    }
    if (game.phase === "dealer") return "Dealer plays…";
    if (game.phase === "results") {
      return "Round " + game.round + " complete. "
        + (isHost() ? "Press Start Round for the next hand." : "Host can start the next round.");
    }
    if (!mySeat()) return "Watching the table.";
    if (isHost()) return "Place your bet, then press Start Round.";
    return "Place your bet and ready up when you want to play.";
  }
  function renderStatus() {
    const pill = phaseText();
    if (phasePillEl.textContent !== pill) phasePillEl.textContent = pill;
    const txt = statusText();
    if (tableStatusEl.textContent !== txt) tableStatusEl.textContent = txt;
  }

  // ---------------------------------------------------------------------------
  // Table render (view for render.js)
  // ---------------------------------------------------------------------------
  function renderTable() {
    const phase = game.phase;
    const dealerCards = game.dealer.cards.slice();
    const hideHole = phase !== "lobby" && game.dealer.hidden && dealerCards.length > 0;
    if (hideHole) dealerCards.push(HOLE);

    let dealerText = "";
    let dealerState = "";
    const shown = game.dealer.cards;
    if (shown.length) {
      if (hideHole) {
        const up = shown[0];
        dealerText = "Showing: " + (shown.length === 1 && cardRank(up) === "A" ? "A (soft 11)" : String(game.dealer.total));
      } else {
        const total = game.dealer.total;
        dealerText = "Total: " + total;
        dealerState = total > 21 ? "bust" : (isBlackjack(shown) ? "bj" : (total === 21 ? "21" : ""));
      }
    }

    const seats = (phase === "lobby" ? [] : game.order).map((id, idx) => {
      const cards = game.hands[id] || [];
      const t = game.totals[id];
      const total = t ? t.total : handValue(cards);
      const soft = t ? t.soft : isSoftHand(cards);
      const bet = Number(game.bets[id] || 0);
      const dbl = !!game.doubled[id];
      const result = phase === "results" ? String(game.results[id] || "") : "";
      const outcome = result ? resultToOutcome(result) : "";
      const natural = !!game.blackjacks[id] || isBlackjack(cards);
      let metaText;
      if (phase === "results") metaText = result;
      else if (bet > 0) metaText = dbl ? "Bet " + fmtChips(bet) + " ×2" : "Bet " + fmtChips(bet);
      else metaText = game.done[id] ? "Done" : "Playing";
      const you = !!game.you && id === game.you;
      return {
        id: id,
        idx: idx,
        name: nameOf(id),
        label: nameOf(id) + (you ? " (You)" : ""),
        you: you,
        active: phase === "playing" && id === game.turn,
        cards: cards.slice(),
        total: total,
        soft: soft,
        bet: bet,
        doubled: dbl,
        blackjack: natural,
        bust: total > 21,
        stand: !!game.done[id] && !natural && total <= 21 && cards.length > 0,
        metaText: metaText,
        result: result,
        outcome: outcome,
        payout: outcome ? Math.max(0, Number(game.payouts[id] || 0)) : 0
      };
    });

    return {
      round: game.round,
      // render.js knows lobby / playing / results; the dealer's turn is part of play
      phase: phase === "dealer" ? "playing" : phase,
      hideHole: hideHole,
      dealer: dealerCards,
      dealerText: dealerText,
      dealerState: dealerState,
      myTurn: phase === "playing" && !!game.you && game.turn === game.you,
      emptyText: "No active round players yet.",
      seats: seats
    };
  }

  function dealerAnimating() {
    try {
      return dealerCardsEl.getAnimations({ subtree: true })
        .some((a) => a.playState === "running" || a.playState === "pending");
    } catch (_e) { return false; }
  }

  // Draw the felt. The hole card is on the felt under a stand-in code while it
  // is face down; at the reveal the real card is swapped in first (still face
  // down, no motion) so render.js turns it over and deals the dealer's draws
  // instead of redrawing the dealer's hand.
  function renderFelt() {
    if (!window.BJArt) return;
    const view = renderTable();
    const prev = lastView;
    const swap = !!prev && prev.phase !== "lobby" && view.phase !== "lobby"
      && prev.round === view.round && prev.hideHole && !view.hideHole
      && prev.dealer.length >= 2 && prev.dealer[1] === HOLE && view.dealer.length >= 2;
    if (swap && dealerAnimating()) {
      // the deal is still flying in: turn the card over once it has landed
      if (!feltDefer.since) feltDefer.since = Date.now();
      if (Date.now() - feltDefer.since < 2500) {
        clearTimeout(feltDefer.timer);
        feltDefer.timer = setTimeout(renderFelt, 120);
        return;
      }
    }
    clearTimeout(feltDefer.timer);
    feltDefer = { timer: 0, since: 0 };
    if (swap) window.BJArt.renderTable(Object.assign({}, prev, { dealer: [view.dealer[0], view.dealer[1]] }));
    maybeShowRoundBanner();
    window.BJArt.renderTable(view);
    lastView = view;
  }

  function renderControls() {
    const me = mySeat();
    const you = game.you;
    const isMyTurn = online.connected && game.phase === "playing" && !!you && game.turn === you;
    const myCards = isMyTurn ? (game.hands[you] || []) : [];
    const myBet = Number(game.bets[you] || 0);
    const chips = wallet ? Number(wallet.chips) || 0 : 0;
    const canAct = isMyTurn && !game.done[you] && !online.busy;
    hitBtn.disabled = !canAct;
    standBtn.disabled = !canAct;
    if (doubleBtn) doubleBtn.disabled = !(canAct && myCards.length === 2 && !game.doubled[you] && chips >= myBet);
    startRoundBtn.disabled = !(online.connected && isHost() && betweenRounds() && !online.busy);
    readyBtn.disabled = !(online.connected && me && betweenRounds());
    leaveRoomBtn.disabled = !(online.connected || online.wantRoom || net.ws);
  }

  function updateReadyButton() {
    const me = mySeat();
    const on = !!(me && me.ready);
    readyBtn.textContent = "Ready: " + (on ? "On" : "Off");
    readyBtn.classList.toggle("btn-primary", on);
    readyBtn.classList.toggle("btn-ghost", !on);
  }

  function renderName() {
    // The name at the table is the account's display name (set by the server).
    const me = mySeat();
    const name = me ? me.name : "";
    if (playerNameEl.value !== name) playerNameEl.value = name;
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
    // chips escrowed on the felt are not "broke"
    const broke = availableChips() < BROKE_BELOW;
    if (topupBtn) topupBtn.hidden = !broke;
    if (walletBannerEl) {
      if (broke) {
        walletBannerEl.hidden = false;
        walletBannerEl.textContent = "You are below " + fmtChips(BROKE_BELOW) + " chips — claim a free top-up.";
      } else {
        walletBannerEl.hidden = true;
      }
    }
  }

  function renderBetInput() {
    if (!betInputEl) return;
    if (document.activeElement !== betInputEl) betInputEl.value = String(online.localBet);
    const chips = availableChips();
    if (betDownBtn) betDownBtn.disabled = online.localBet <= BET_MIN;
    if (betUpBtn)   betUpBtn.disabled   = online.localBet >= BET_MAX || online.localBet + BET_STEP > chips;
    if (window.BJArt) window.BJArt.betPreview(document.getElementById("betPreview"), online.localBet);
  }

  function showRoundResult(text, kind) {
    if (!roundResultEl) return;
    if (window.BJArt) { window.BJArt.banner(roundResultEl, text || "", kind || ""); return; }
    roundResultEl.textContent = text || "";
    roundResultEl.classList.remove("win", "lose", "push", "warn", "ok");
    if (kind) roundResultEl.classList.add(kind);
    roundResultEl.hidden = !text;
  }

  // The server settled the hand; show what it paid.
  function maybeShowRoundBanner() {
    if (game.phase !== "results" || !game.you || bannerRound === game.round) return;
    const result = game.results[game.you];
    if (!result) return; // sat this round out
    bannerRound = game.round;
    const delta = Number(game.payouts[game.you] || 0);
    const kind = delta > 0 ? "win" : (delta < 0 ? "lose" : "push");
    showRoundResult(result + " — " + (delta > 0 ? "+" : "") + fmtChips(delta) + " chips", kind);
  }

  // The server recorded the round in the arcade stats: let the stats modal
  // (game-stats.js) know its numbers are stale. Nothing is posted from here.
  function noteRoundRecorded() {
    if (game.phase !== "results" || !game.you || !game.results[game.you] || statsRound === game.round) return;
    statsRound = game.round;
    try {
      window.dispatchEvent(new CustomEvent("cartofia:game-result", {
        detail: { request: { slug: "blackjack", recorded_by: "table" }, response: null, status: 0 }
      }));
    } catch (_e) { /* old browser: the modal refreshes on open anyway */ }
  }

  function renderAll() {
    renderStatus();
    renderLobby();
    renderFelt();
    renderControls();
    updateReadyButton();
    renderName();
    renderWallet();
    renderBetInput();
  }

  // ---------------------------------------------------------------------------
  // Wallet API (bankroll before sitting down; top-up)
  // ---------------------------------------------------------------------------
  function loadWallet() {
    // Ask who we are first (200 for guests too) so a guest never hits the
    // wallet's 401; a legacy bearer token goes straight to the wallet.
    const who = getAuthToken()
      ? Promise.resolve(true)
      : fetch(AUTH_ME_URL, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => !!(j && j.authenticated))
        .catch(() => true);
    who
      .then((signedIn) => (signedIn ? authedFetch(WALLET_URL) : null))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => {
        // a seated player's wallet comes with every table state
        if (j && j.wallet) { if (!mySeat()) wallet = j.wallet; }
        else if (!mySeat()) wallet = null;
        trimBetToWallet();
        renderAll();
      })
      .catch(() => { renderAll(); });
  }

  function requestTopup() {
    authedFetch(TOPUP_URL, { method: "POST" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, body: j })))
      .then(({ ok, body }) => {
        if (ok && body && body.wallet) {
          wallet = body.wallet;
          showRoundResult("+" + fmtChips(body.delta) + " chips topped up", "ok");
          // the table re-reads the wallet on a heartbeat and sends a fresh state
          if (online.connected) send({ type: "heartbeat" });
        } else if (body && body.reason) {
          showRoundResult(body.reason, "warn");
          if (body.wallet) wallet = body.wallet;
        }
        renderAll();
      })
      .catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Socket plumbing
  // ---------------------------------------------------------------------------
  function rawSend(ws, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(payload)); return true; }
    catch (_e) { return false; }
  }
  function send(payload) { return rawSend(net.ws, payload); }

  function setBusy(on) {
    online.busy = !!on;
    clearTimeout(online.busyTimer);
    if (on) online.busyTimer = setTimeout(() => { online.busy = false; renderControls(); }, 5000);
  }

  function roleLabel() {
    if (isHost()) return "host";
    if (mySeat()) return "seated";
    return "watching";
  }
  function showOnline() {
    netState("ok", "Online: " + online.room + " (" + roleLabel() + ")");
  }

  function saveTable(code) {
    try {
      if (code) sessionStorage.setItem(TABLE_STORAGE_KEY, code);
      else sessionStorage.removeItem(TABLE_STORAGE_KEY);
    } catch (_e) {}
  }
  function savedTable() {
    try { return normalizeRoomCode(sessionStorage.getItem(TABLE_STORAGE_KEY) || ""); }
    catch (_e) { return ""; }
  }

  function dropSocket() {
    const ws = net.ws;
    net.ws = null;
    clearTimeout(net.retryTimer);
    clearTimeout(net.dropTimer);
    if (ws) { try { ws.close(); } catch (_e) {} }
  }

  function resetTable() {
    online.connected = false;
    online.room = "";
    online.betSent = null;
    setBusy(false);
    resetGame();
    bannerRound = -1;
    showRoundResult("", null);
  }

  // Open a socket and send `first()` once it is open.
  function openSocket(first) {
    dropSocket();
    net.manualClose = false;
    let ws;
    try { ws = new WebSocket(WS_URL); }
    catch (_e) {
      netState("warn", "Socket error");
      setFlash("Could not open websocket.");
      return;
    }
    net.ws = ws;
    ws.addEventListener("open", () => {
      if (net.ws !== ws) return;
      rawSend(ws, first());
    });
    ws.addEventListener("message", (event) => {
      if (net.ws !== ws) return;
      let data = null;
      try { data = JSON.parse(event.data); } catch (_e) { return; }
      if (!data || typeof data !== "object") return;
      onMessage(data);
    });
    ws.addEventListener("close", () => onSocketClosed(ws));
    ws.addEventListener("error", () => { /* close follows */ });
    renderAll();
  }

  function onSocketClosed(ws) {
    if (net.ws !== ws) return;
    net.ws = null;
    clearTimeout(net.dropTimer);
    online.connected = false;
    setBusy(false);
    if (!net.manualClose && online.wantRoom) {
      scheduleReconnect();
    } else {
      resetTable();
      netState("warn", "Offline");
    }
    renderAll();
  }

  function scheduleReconnect() {
    clearTimeout(net.retryTimer);
    net.attempt += 1;
    const base = Math.min(10000, 600 * Math.pow(2, Math.min(net.attempt - 1, 5)));
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    netState("warn", "Reconnecting (" + online.wantRoom + ")…");
    net.retryTimer = setTimeout(rejoin, delay);
  }
  function rejoin() {
    const code = online.wantRoom;
    if (!code || net.ws) return;
    online.pendingPassword = online.password;
    openSocket(() => ({ type: "join", code: code, password: online.password || undefined }));
  }

  function onMessage(m) {
    switch (m.type) {
      case "room": onRoom(m); break;
      case "state": onState(m.state); break;
      case "error": onServerError(m); break;
      case "left":
        onLeft();
        // the same account took this seat from another tab or device
        if (m.reason === "replaced") setFlash("You're at this table in another window.", 8000);
        break;
      default: break;
    }
  }

  function onRoom(m) {
    clearTimeout(net.dropTimer);
    online.connected = true;
    online.room = normalizeRoomCode(m.code) || online.wantRoom;
    online.wantRoom = online.room;
    online.password = online.pendingPassword;
    online.betSent = null;
    net.attempt = 0;
    if (!game.you && m.you != null) game.you = String(m.you);
    roomCodeEl.value = online.room;
    saveTable(online.room);
    showOnline();
    renderAll();
  }

  function onState(st) {
    if (!st || typeof st !== "object") return;
    setBusy(false);
    const prevRound = game.round;
    mirrorState(st);
    if (game.round !== prevRound) online.betSent = null;
    trimBetToWallet();
    if (online.connected) showOnline();
    syncBet();
    renderAll();
    noteRoundRecorded();
  }

  function onServerError(m) {
    const msg = String(m.message || "Something went wrong.");
    setBusy(false);
    if (online.connected) {
      setFlash(msg);
      renderAll();
      return;
    }
    // Not in a room yet. The server may still put us in one (a guest joining
    // is told it can't sit, then watches), so give it a moment before closing.
    netState("warn", msg);
    setFlash(msg, 6000);
    const reconnecting = !!online.wantRoom;
    if (reconnecting) {
      // the table we were at is gone (or won't have us back): stop retrying
      online.wantRoom = "";
      online.password = "";
      saveTable("");
      resetTable();
      lastView = null;
    }
    clearTimeout(net.dropTimer);
    const ws = net.ws;
    net.dropTimer = setTimeout(() => {
      if (net.ws !== ws || online.connected) return;
      net.manualClose = true;
      dropSocket();
      netState("warn", msg);
      renderAll();
    }, 1500);
    renderAll();
  }

  function onLeft() {
    online.wantRoom = "";
    online.password = "";
    saveTable("");
    net.manualClose = true;
    dropSocket();
    resetTable();
    netState("warn", "Offline");
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Intents
  // ---------------------------------------------------------------------------
  function leaveTable() {
    if (net.ws && online.connected) send({ type: "leave" });
    onLeft();
  }

  function createTable() {
    const pw = String(roomPasswordEl.value || "").slice(0, 32);
    if (online.connected) send({ type: "leave" });
    online.wantRoom = "";
    online.pendingPassword = pw;
    saveTable("");
    resetTable();
    netState("warn", "Creating table…");
    openSocket(() => ({ type: "create", password: pw || undefined }));
  }

  function joinTable(rawCode) {
    const code = normalizeRoomCode(rawCode);
    roomCodeEl.value = code;
    if (code.length < 4) {
      setFlash("Room code must be at least 4 characters.");
      return;
    }
    const pw = String(roomPasswordEl.value || "").slice(0, 32);
    if (online.connected) send({ type: "leave" });
    online.wantRoom = "";
    online.pendingPassword = pw;
    saveTable("");
    resetTable();
    netState("warn", "Joining " + code + "…");
    openSocket(() => ({ type: "join", code: code, password: pw || undefined }));
  }

  function sendAction(action) {
    if (!online.connected || game.phase !== "playing" || online.busy) return;
    if (!game.you || game.turn !== game.you) return;
    if (send({ type: "action", action: action })) { setBusy(true); renderControls(); }
  }

  function applyBet(nextRaw) {
    let next = clampBet(nextRaw);
    const cap = availableChips();
    if (next > cap) next = floorBet(cap);
    online.localBet = next;
    online.betSent = null;
    try { window.localStorage.setItem(BET_STORAGE_KEY, String(online.localBet)); } catch (_e) {}
    syncBet();
    renderBetInput();
    renderLobby();
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
  roomCodeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); joinTable(roomCodeEl.value); } });
  roomPasswordEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); joinTable(roomCodeEl.value); } });

  createRoomBtn.addEventListener("click", createTable);
  joinRoomBtn.addEventListener("click", () => joinTable(roomCodeEl.value));
  leaveRoomBtn.addEventListener("click", leaveTable);

  readyBtn.addEventListener("click", () => {
    const me = mySeat();
    if (!online.connected || !me || !betweenRounds()) return;
    syncBet();
    send({ type: "ready", ready: !me.ready });
  });

  startRoundBtn.addEventListener("click", () => {
    if (!online.connected || !isHost() || !betweenRounds() || online.busy) return;
    syncBet();
    if (send({ type: "start" })) { setBusy(true); renderControls(); }
  });

  hitBtn.addEventListener("click",   () => sendAction("hit"));
  standBtn.addEventListener("click", () => sendAction("stand"));
  if (doubleBtn) doubleBtn.addEventListener("click", () => sendAction("double"));

  if (betInputEl) {
    betInputEl.addEventListener("change", () => applyBet(betInputEl.value));
    betInputEl.addEventListener("blur",   () => applyBet(betInputEl.value));
  }
  if (betDownBtn) betDownBtn.addEventListener("click", () => applyBet(online.localBet - BET_STEP));
  if (betUpBtn)   betUpBtn.addEventListener("click",   () => applyBet(online.localBet + BET_STEP));
  if (topupBtn)   topupBtn.addEventListener("click",   requestTopup);

  // "Leave table" in the top bar really leaves; a reload keeps the seat
  // (the server resumes it when this account reconnects).
  if (backLinkEl) backLinkEl.addEventListener("click", () => {
    if (net.ws && online.connected) send({ type: "leave" });
    saveTable("");
  });

  setInterval(() => { if (net.ws) send({ type: "heartbeat" }); }, HEARTBEAT_MS);
  // turn countdown in the status line
  setInterval(() => { if (game.phase === "playing" && game.turnDeadline) renderStatus(); }, 500);
  window.addEventListener("online", () => {
    if (!net.ws && online.wantRoom) { clearTimeout(net.retryTimer); rejoin(); }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  loadBet();
  resetGame();
  netState("warn", "Offline");
  renderAll();
  loadWallet();
  const resumeCode = savedTable();
  if (resumeCode) {
    roomCodeEl.value = resumeCode;
    online.wantRoom = resumeCode;
    rejoin();
  }
})();
