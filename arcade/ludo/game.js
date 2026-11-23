/* ==========================================================================
   Cartofia Ludo — page UI, screens and WebSocket client.
   Renderer (board graphics) lives in render.js (window.LudoRenderer);
   sounds in sfx.js (window.LudoSfx). This file owns everything else.
   Protocol: /home/claude/ludo-spec/SPEC.md §8 (client side).
   ========================================================================== */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const WS_URL = window.CARTOFIA_LUDO_WS_URL
    || ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/rooms/ludo");
  const SIGN_IN_URL = "/api/auth/start?next=" + encodeURIComponent("/arcade/ludo/");
  const SEAT_COLOR = ["red", "green", "yellow", "blue"];
  const SEAT_LABEL = ["Red", "Green", "Yellow", "Blue"];
  const EMOTES = ["👍", "😂", "😮", "😡", "🎉", "😭", "🔥", "🥔"];
  const LS_KEYS = { name: "cartofia_ludo_name", mode: "cartofia_ludo_mode", bots: "cartofia_ludo_bots", muted: "cartofia_ludo_muted" };
  const SS_RESUME = "cartofia_ludo_resume";
  const PING_MS = 25000;
  const STALE_MS = 55000;
  const ANIM_TIMEOUT_MS = 20000;
  const ACTION_PENDING_MS = 5000;
  const LOG_MAX = 80;
  const POWER_ORDER = ["double_dice", "reroll", "boost", "shield", "freeze", "bomb", "swap"];
  const FALLBACK_META = {
    double_dice: { name: "Double Dice", emoji: "🎲", color: "#a78bfa", description: "Before rolling: throw two dice and move the total. A 6 on either die brings a token out." },
    reroll:      { name: "Re-roll",     emoji: "🔄", color: "#38bdf8", description: "After rolling: throw the die again." },
    boost:       { name: "Rocket",      emoji: "🚀", color: "#fb923c", description: "After rolling: +3 squares for a token already on the board." },
    shield:      { name: "Shield",      emoji: "🛡️", color: "#34d399", description: "Protect one token from captures and bombs for 2 rounds." },
    freeze:      { name: "Freeze",      emoji: "❄️", color: "#7dd3fc", description: "Pick a rival — their next turn is skipped." },
    bomb:        { name: "Bomb",        emoji: "💣", color: "#f87171", description: "Plant a bomb on an empty square. Rivals that land on it go home." },
    swap:        { name: "Swap",        emoji: "🌀", color: "#f472b6", description: "Before rolling: trade places with a rival token." },
  };
  const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };
  const THROW_ITEMS = ["tomato", "egg", "rose", "potato", "water", "confetti"];
  const THROW_META = {
    tomato: { name: "Tomato", a: "a tomato", emoji: "🍅" }, egg: { name: "Egg", a: "an egg", emoji: "🥚" },
    rose: { name: "Rose", a: "a rose", emoji: "🌹" }, potato: { name: "Potato", a: "a potato", emoji: "🥔" },
    water: { name: "Water", a: "a water balloon", emoji: "💧" }, confetti: { name: "Confetti", a: "confetti", emoji: "🎉" },
  };
  const CHAT_MAX = 200;
  const CHAT_GAP_MS = 1500;
  const THROW_GAP_MS = 3000;
  const CHAT_KEEP = 60;
  const SS_MUTES = "cartofia_ludo_mutes";
  // Server / engine error codes → player-friendly wording (fallback: server message).
  const FRIENDLY_ERRORS = {
    not_your_turn: "Hold on — it’s not your turn yet.",
    illegal_move: "That move isn’t allowed right now.",
    bad_action: "That action isn’t available right now.",
    bad_seat: "That seat isn’t yours.",
    game_over: "This match is already over.",
    not_started: "The match hasn’t started yet.",
    already_started: "The match has already started.",
    not_in_match: "You’re not in a match right now.",
    resume_failed: "Couldn’t rejoin that match — it may have ended.",
    busy: "Finish or leave your current match first.",
    already_queued: "You’re already searching in another tab.",
    bad_code: "Room codes are 4 letters or digits.",
    room_not_found: "No room with that code. Check it and try again.",
    room_in_progress: "That room’s game has already started.",
    room_full: "That room is full.",
    already_seated: "You’re already in this room in another tab.",
    not_in_room: "You’re not in a room any more.",
    not_host: "Only the host can do that.",
    seat_taken: "Someone just took that seat.",
    cannot_start: "Need at least 2 players, and everyone ready.",
    rate_limited: "Slow down a little!",
    server_error: "Something went wrong on the server. Try again.",
    hello_required: "Still connecting — try again in a second.",
    paused: "The match is paused while players decide whether to keep going.",
    no_prompt: "That question has already closed.",
    already_answered: "You’ve already answered.",
    not_finished: "Play again opens once the match has ended.",
    bad_target: "Pick another player to throw at.",
    bad_request: "That didn’t work — try again.",
  };
  // Errors from chat / throws / the continue prompt: toast only, never disturb screens or pending starts.
  const SOCIAL_ERRORS = new Set(["rate_limited", "bad_target", "no_prompt", "already_answered", "paused", "bad_request"]);

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "style" && typeof v === "object") {
          for (const sk of Object.keys(v)) {
            if (sk.startsWith("--")) node.style.setProperty(sk, v[sk]);
            else node.style[sk] = v[sk];
          }
        }
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (k === "dataset") Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return node;
  }

  function lsGet(key, dflt) { try { const v = localStorage.getItem(key); return v == null ? dflt : v; } catch (_) { return dflt; } }
  function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (_) { /* ignore */ } }
  function ssGet(key) { try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch (_) { return null; } }
  function ssSet(key, val) { try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* ignore */ } }
  function ssDel(key) { try { sessionStorage.removeItem(key); } catch (_) { /* ignore */ } }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function initials(name) { const s = String(name || "?").trim(); const parts = s.split(/\s+/); return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : (parts[0][1] || ""))).toUpperCase(); }
  function normCode(raw) { return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }
  function cleanName(raw) { return String(raw || "").replace(/[^\p{L}\p{N} _.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 20); }
  function fmtInt(n) { return Number(num(n, 0)).toLocaleString("en-GB"); }
  function pct(rate, games, wins) {
    let r = Number(rate);
    if (!Number.isFinite(r)) r = games ? wins / games : 0;
    if (r > 1) r = r / 100;
    return Math.round(r * 100) + "%";
  }
  function relTime(iso) {
    if (!iso) return "";
    const t = typeof iso === "number" ? (iso < 1e12 ? iso * 1000 : iso) : Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 7) return Math.floor(s / 86400) + "d ago";
    return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function levelInfo(xp, stats) {
    if (stats && stats.xp_for_next_level > 0 && stats.xp_into_level != null && stats.level != null) {
      const into = num(stats.xp_into_level, 0), span = num(stats.xp_for_next_level, 1);
      return { level: num(stats.level, 1), xp: num(stats.xp, 0), into, span, pct: clamp(into / span, 0, 1) };
    }
    xp = Math.max(0, num(xp, 0));
    const level = Math.floor(Math.sqrt(xp / 100)) + 1;
    const start = 100 * (level - 1) * (level - 1);
    const end = 100 * level * level;
    return { level, xp, into: xp - start, span: end - start, pct: (xp - start) / (end - start) };
  }
  function withTimeout(p, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
  async function getJSON(url) {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    let body = null;
    try { body = await r.json(); } catch (_) { body = null; }
    return { ok: r.ok, status: r.status, body };
  }

  // Sounds: graceful no-op if sfx.js is missing.
  const Sfx = {
    play(name) { try { if (window.LudoSfx && typeof window.LudoSfx.play === "function") window.LudoSfx.play(name); } catch (_) { /* ignore */ } },
    setMuted(m) { try { if (window.LudoSfx && typeof window.LudoSfx.setMuted === "function") window.LudoSfx.setMuted(m); } catch (_) { /* ignore */ } },
  };

  function powerMeta(id) {
    const base = FALLBACK_META[id] || { name: id, emoji: "✨", color: "#7ca6ff", description: "" };
    const R = window.LudoRenderer;
    const ext = R && R.POWERUP_META && R.POWERUP_META[id];
    return Object.assign({}, base, ext || {});
  }
  function powerIcon(id, cls) {
    const m = powerMeta(id);
    const wrap = h("span", { class: "pw-icon " + (cls || ""), style: { "--pw": m.color || "#7ca6ff" }, "aria-hidden": "true" });
    if (m.icon_url) wrap.appendChild(h("img", { src: m.icon_url, alt: "", width: "28", height: "28", decoding: "async" }));
    else wrap.textContent = m.emoji || "✨";
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------
  const dom = {
    body: document.body,
    tabs: $("ludoTabs"),
    headerStatus: $("headerStatus"),
    netPill: $("netPill"), netPillText: $("netPillText"),
    netBanner: $("netBanner"), netBannerText: $("netBannerText"),
    // home
    modeToggle: $("modeToggle"), botsSeg: $("botsSeg"),
    btnPlayBots: $("btnPlayBots"), btnQuick: $("btnQuick"), btnCreate: $("btnCreate"),
    joinForm: $("joinForm"), joinCode: $("joinCode"), btnJoin: $("btnJoin"),
    powerList: $("powerList"), powerExplainer: $("powerExplainer"), powerExplainerNote: $("powerExplainerNote"),
    accountCard: $("accountCard"), quickDesc: $("quickDesc"),
    // queue
    queueMode: $("queueMode"), queueSlots: $("queueSlots"), queueInfo: $("queueInfo"), btnCancelQueue: $("btnCancelQueue"), queueTitle: $("queueTitle"),
    // lobby
    roomCode: $("roomCode"), lobbyMode: $("lobbyMode"), inviteLink: $("inviteLink"), btnCopyInvite: $("btnCopyInvite"),
    seatGrid: $("seatGrid"), lobbyHint: $("lobbyHint"), btnLeaveLobby: $("btnLeaveLobby"), btnReady: $("btnReady"), btnStart: $("btnStart"),
    // game
    boardHost: $("boardHost"),
    turnCard: $("turnCard"), turnDot: $("turnDot"), turnTitle: $("turnTitle"), turnSub: $("turnSub"), turnClock: $("turnClock"),
    actionRow: $("actionRow"), btnRoll: $("btnRoll"), chooseRow: $("chooseRow"), btnPass: $("btnPass"),
    targetBar: $("targetBar"), targetText: $("targetText"), targetOptions: $("targetOptions"), btnCancelTarget: $("btnCancelTarget"),
    autopilotNote: $("autopilotNote"),
    powerCard: $("powerCard"), powerBar: $("powerBar"), powerUsedNote: $("powerUsedNote"),
    btnEmote: $("btnEmote"), emotePop: $("emotePop"), btnMute: $("btnMute"), muteIcon: $("muteIcon"), muteLabel: $("muteLabel"),
    btnResign: $("btnResign"), btnLeaveGame: $("btnLeaveGame"), btnAuto: $("btnAuto"), autoLabel: $("autoLabel"),
    eventLog: $("eventLog"), matchMeta: $("matchMeta"),
    // other screens
    statsBody: $("statsBody"), lbSort: $("lbSort"), lbBody: $("lbBody"),
    resultsModal: $("resultsModal"), resultsCard: $("resultsCard"),
    confirmModal: $("confirmModal"), confirmTitle: $("confirmTitle"), confirmText: $("confirmText"), confirmYes: $("confirmYes"), confirmNo: $("confirmNo"),
    toastHost: $("toastHost"), srLive: $("srLive"),
    // chat
    chatPanel: $("chatPanel"), chatToggle: $("chatToggle"), chatBadge: $("chatBadge"), chatBody: $("chatBody"),
    chatList: $("chatList"), chatEmpty: $("chatEmpty"), chatForm: $("chatForm"), chatInput: $("chatInput"),
    lobbyChatSlot: $("lobbyChatSlot"), gameChatSlot: $("gameChatSlot"), btnChat: $("btnChat"), chatToolBadge: $("chatToolBadge"),
    // log / power help
    logCard: $("logCard"), btnLogMore: $("btnLogMore"), powerHelp: $("powerHelp"), powerListGame: $("powerListGame"),
    // continue prompt
    continueModal: $("continueModal"), continueTitle: $("continueTitle"), continueText: $("continueText"),
    continueSecs: $("continueSecs"), continueRing: $("continueRing"), continueYes: $("continueYes"), continueNo: $("continueNo"),
  };

  // ---------------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------------
  const app = {
    screen: "home",
    mode: lsGet(LS_KEYS.mode, "power") === "classic" ? "classic" : "power",
    bots: clamp(num(lsGet(LS_KEYS.bots, "3"), 3), 1, 3),
    muted: (window.LudoSfx && typeof window.LudoSfx.muted === "boolean") ? window.LudoSfx.muted : lsGet(LS_KEYS.muted, "0") === "1",
    auth: null,          // null = unknown, false = guest, object = signed in
    myStats: null,       // /api/ludo/stats/me payload
    statsState: "idle",  // idle | loading | ok | error
    lbSort: "wins",
    welcome: null,
    intent: null,        // last start intent, for "Play again" + reconnects
    awaiting: null,      // "queue" | "lobby" | "match" while a request is in flight
    pendingRoom: null,   // room code to join once connected (invite links)
    room: null,          // last room_update
    roomAfterMatch: false,
    queue: null,         // { humans, startsAt, mode }
    match: null,         // { match_id, you_seat, seat_token, mode, started }
    shownState: null,    // state the renderer currently shows
    you: { seat: null, legal_actions: [] },
    deadline: null,
    lastSeq: null,
    pending: false,
    pendingTimer: null,
    targeting: null,
    ended: null,
    resultsShown: false,
    cueKey: "",
    tickSecond: -1,
    emoteReadyAt: 0,
    gen: 0,
    seatStatus: {},
    achExpanded: false,
    syncing: false,
    chat: [],            // [{seat, name, text, ts}] — rendered with textContent only
    chatUnread: 0,
    chatOpenGame: !(window.matchMedia && window.matchMedia("(max-width: 920px)").matches),
    chatReadyAt: 0,
    throwReadyAt: 0,
    again: null,         // pending play_again {at, kind, code}
    prompt: null,        // open continue prompt {deadline, winner}
  };

  let renderer = null;
  const anim = { queue: [], running: false };

  // ---------------------------------------------------------------------------
  // Toasts, live region, confirm dialog
  // ---------------------------------------------------------------------------
  function toast(msg, kind, ms) {
    if (!msg) return;
    const t = h("div", { class: "toast toast-" + (kind || "info"), role: kind === "error" ? "alert" : "status" },
      h("span", { class: "toast-icon", "aria-hidden": "true", text: kind === "error" ? "⚠️" : kind === "ok" ? "✅" : "ℹ️" }),
      h("span", { class: "toast-text", text: String(msg) }));
    dom.toastHost.appendChild(t);
    while (dom.toastHost.children.length > 4) dom.toastHost.firstChild.remove();
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms || 4200);
  }

  let srTimer = null;
  function announce(text) {
    if (!text) return;
    clearTimeout(srTimer);
    dom.srLive.textContent = "";
    srTimer = setTimeout(() => { dom.srLive.textContent = text; }, 60);
  }

  let confirmResolve = null;
  let confirmReturnFocus = null;
  function confirmDialog(title, text, yesLabel) {
    if (confirmResolve) confirmResolve(false);
    dom.confirmTitle.textContent = title;
    dom.confirmText.textContent = text;
    dom.confirmYes.textContent = yesLabel || "Confirm";
    confirmReturnFocus = document.activeElement;
    dom.confirmModal.classList.remove("hidden");
    setTimeout(() => dom.confirmNo.focus(), 20);
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function closeConfirm(result) {
    if (dom.confirmModal.classList.contains("hidden")) return;
    dom.confirmModal.classList.add("hidden");
    const r = confirmResolve; confirmResolve = null;
    if (confirmReturnFocus && confirmReturnFocus.focus) { try { confirmReturnFocus.focus(); } catch (_) { /* ignore */ } }
    if (r) r(!!result);
  }
  dom.confirmYes.addEventListener("click", () => closeConfirm(true));
  dom.confirmNo.addEventListener("click", () => closeConfirm(false));
  dom.confirmModal.addEventListener("click", (e) => { if (e.target === dom.confirmModal) closeConfirm(false); });

  function trapFocus(modal, e) {
    if (e.key !== "Tab" || modal.classList.contains("hidden")) return;
    const f = Array.from(modal.querySelectorAll("button:not([disabled]), a[href], input:not([disabled])")).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---------------------------------------------------------------------------
  // Generic radio groups (roving tabindex + arrow keys)
  // ---------------------------------------------------------------------------
  function radioGroup(container, attr, onChange) {
    const opts = () => Array.from(container.querySelectorAll("[role=radio]"));
    function select(btn, fire) {
      opts().forEach((o) => {
        const on = o === btn;
        o.setAttribute("aria-checked", on ? "true" : "false");
        o.tabIndex = on ? 0 : -1;
        o.classList.toggle("active", on);
      });
      if (fire) onChange(btn.dataset[attr]);
    }
    container.addEventListener("click", (e) => {
      const b = e.target.closest("[role=radio]");
      if (b && container.contains(b) && !b.disabled) select(b, true);
    });
    container.addEventListener("keydown", (e) => {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const list = opts();
      const i = list.indexOf(document.activeElement);
      const d = (e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 1;
      const next = list[(i + d + list.length) % list.length];
      next.focus(); select(next, true);
    });
    return {
      set(value) { const b = opts().find((o) => o.dataset[attr] === String(value)); if (b) select(b, false); },
    };
  }

  // ---------------------------------------------------------------------------
  // Screens & tabs
  // ---------------------------------------------------------------------------
  const TAB_SCREENS = { play: "home", stats: "stats", leaderboard: "leaderboard" };

  function showScreen(name) {
    const prev = app.screen;
    app.screen = name;
    dom.body.dataset.screen = name;
    document.querySelectorAll(".ludo-screen").forEach((s) => s.classList.toggle("hidden", s.dataset.screen !== name));
    const tabbed = name === "home" || name === "stats" || name === "leaderboard";
    dom.tabs.classList.toggle("hidden", !tabbed);
    if (tabbed) {
      const tab = name === "home" ? "play" : name;
      dom.tabs.querySelectorAll("[role=tab]").forEach((t) => {
        const on = t.dataset.tab === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
    }
    if (name !== "game" && prev === "game") teardownRenderer();
    closePodMenu();
    placeChat(name);
    updateHeaderStatus();
    updateNetUI();
    if (name !== prev) window.scrollTo({ top: 0 });
  }

  function setTab(tab, fromHash) {
    const screen = TAB_SCREENS[tab] || "home";
    if (!(app.screen === "home" || app.screen === "stats" || app.screen === "leaderboard")) return;
    showScreen(screen);
    if (!fromHash) {
      const hash = tab === "play" ? "" : "#" + tab;
      history.replaceState(null, "", location.pathname + location.search + hash);
    }
    if (screen === "stats") loadStatsScreen();
    if (screen === "leaderboard") loadLeaderboard();
  }

  dom.tabs.addEventListener("click", (e) => {
    const t = e.target.closest("[role=tab]");
    if (t) setTab(t.dataset.tab);
  });
  dom.tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const tabs = Array.from(dom.tabs.querySelectorAll("[role=tab]"));
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); setTab(next.dataset.tab);
  });
  window.addEventListener("hashchange", () => {
    const tab = location.hash.replace("#", "");
    if (TAB_SCREENS[tab]) setTab(tab, true);
  });

  function updateHeaderStatus() {
    let s = "Menu";
    switch (app.screen) {
      case "queue": s = "Searching"; break;
      case "lobby": s = app.room ? "Room " + app.room.code : "Lobby"; break;
      case "game": {
        const st = app.shownState;
        if (st && st.status !== "playing") s = "Finished";
        else if (st && st.turn && app.match && st.turn.seat === app.match.you_seat) s = "Your turn";
        else s = "Playing";
        break;
      }
      case "stats": s = "Stats"; break;
      case "leaderboard": s = "Leaderboard"; break;
      default: s = "Menu";
    }
    dom.headerStatus.textContent = s;
  }

  // ---------------------------------------------------------------------------
  // Home screen
  // ---------------------------------------------------------------------------
  function guestName() {
    let n = cleanName(lsGet(LS_KEYS.name, ""));
    if (!n) { n = "Guest " + String(1000 + Math.floor(Math.random() * 9000)); lsSet(LS_KEYS.name, n); }
    return n;
  }

  const modeGroup = radioGroup(dom.modeToggle, "mode", (m) => {
    app.mode = m === "classic" ? "classic" : "power";
    lsSet(LS_KEYS.mode, app.mode);
    renderModeInfo();
  });
  const botsGroup = radioGroup(dom.botsSeg, "bots", (b) => {
    app.bots = clamp(num(b, 3), 1, 3);
    lsSet(LS_KEYS.bots, String(app.bots));
    renderPlayButtons();
  });

  function renderModeInfo() {
    modeGroup.set(app.mode);
    const power = app.mode === "power";
    dom.powerExplainer.classList.toggle("dimmed", !power);
    dom.powerExplainerNote.textContent = power
      ? "Land exactly on a crate to grab one. Hold up to 2, use 1 per turn."
      : "Switch to Power mode to play with crates and power-ups.";
    renderPlayButtons();
  }

  function renderPlayButtons() {
    botsGroup.set(app.bots);
    const label = dom.btnPlayBots.querySelector("span");
    label.textContent = "Play vs " + app.bots + (app.bots === 1 ? " bot" : " bots");
    dom.quickDesc.textContent = "Public " + (app.mode === "power" ? "Power" : "Classic") + " queue. Bots fill empty seats after 10s.";
    const busy = !!app.awaiting;
    [dom.btnPlayBots, dom.btnQuick, dom.btnCreate, dom.btnJoin].forEach((b) => { b.disabled = busy; });
    dom.btnPlayBots.classList.toggle("loading", app.awaiting === "match" && app.intent && app.intent.kind === "bots");
  }

  function renderPowerList() {
    [dom.powerList, dom.powerListGame].forEach((list) => {
      if (!list) return;
      list.innerHTML = "";
      POWER_ORDER.forEach((id) => {
        const m = powerMeta(id);
        list.appendChild(h("li", { class: "power-item", style: { "--pw": m.color } },
          powerIcon(id),
          h("div", { class: "power-item-body" },
            h("span", { class: "power-item-name", text: m.name }),
            h("span", { class: "power-item-desc", text: m.description || "" }))));
      });
    });
  }

  // Account card ------------------------------------------------------------
  function avatarEl(name, url, cls) {
    const a = h("span", { class: "avatar " + (cls || ""), "aria-hidden": "true" });
    if (url) a.appendChild(h("img", { src: url, alt: "", loading: "lazy" }));
    else a.textContent = initials(name);
    return a;
  }

  function renderAccount() {
    const card = dom.accountCard;
    card.innerHTML = "";
    if (app.auth === null) {
      card.appendChild(h("div", { class: "acct-loading", text: "Checking your account…" }));
      return;
    }
    if (app.auth) {
      const s = app.myStats && app.myStats.stats;
      const u = (app.myStats && app.myStats.user) || {};
      const display = u.display_name || app.auth.username;
      const lv = levelInfo(s ? s.xp : 0, s);
      const level = lv.level;
      card.appendChild(h("div", { class: "acct-head" },
        avatarEl(display, u.avatar_url, "avatar-lg"),
        h("div", { class: "acct-id" },
          h("span", { class: "acct-name", text: display }),
          h("span", { class: "acct-sub", text: "@" + (u.username || app.auth.username) })),
        h("span", { class: "level-badge", title: "Ludo level" }, h("small", { text: "LV" }), String(level))));
      card.appendChild(h("div", { class: "xp-bar", role: "progressbar", "aria-label": "Progress to next level", "aria-valuemin": "0", "aria-valuemax": String(lv.span), "aria-valuenow": String(lv.into) },
        h("span", { class: "xp-fill", style: { width: Math.round(lv.pct * 100) + "%" } })));
      card.appendChild(h("p", { class: "xp-text", text: s ? (fmtInt(lv.into) + " / " + fmtInt(lv.span) + " XP to level " + (level + 1)) : "Play a match to start earning XP." }));
      card.appendChild(h("div", { class: "acct-stats" },
        statMini("Rating", s ? fmtInt(s.rating) : "1,000"),
        statMini("Wins", s ? fmtInt(s.wins) : "0"),
        statMini("Played", s ? fmtInt(s.games_played) : "0")));
      card.appendChild(h("button", { type: "button", class: "link-btn", onclick: () => setTab("stats") }, "View stats & achievements →"));
    } else {
      card.appendChild(h("div", { class: "acct-head" },
        avatarEl(guestName(), null, "avatar-lg avatar-guest"),
        h("div", { class: "acct-id" },
          h("span", { class: "acct-name", text: "Playing as guest" }),
          h("span", { class: "acct-sub", text: "Guest games aren’t saved" }))));
      const input = h("input", { id: "guestName", class: "ludo-input", type: "text", maxlength: "20", value: guestName(), autocomplete: "nickname", spellcheck: "false" });
      input.addEventListener("change", () => {
        const v = cleanName(input.value) || guestName();
        input.value = v;
        lsSet(LS_KEYS.name, v);
        // The name is sent in `hello`; reconnect lazily if we're idle.
        if (net.ws && !needsConnection() && net.helloName !== v) disconnect();
      });
      card.appendChild(h("label", { class: "field-label", for: "guestName", text: "Your name" }));
      card.appendChild(input);
      card.appendChild(h("a", { class: "btn btn-primary btn-signin", href: SIGN_IN_URL }, "Sign in to save stats"));
      card.appendChild(h("p", { class: "hint", text: "Signed-in players earn XP, a rating, achievements and a spot on the leaderboard." }));
    }
  }
  function statMini(label, value) {
    return h("div", { class: "stat-mini" }, h("span", { class: "stat-mini-value", text: value }), h("span", { class: "stat-mini-label", text: label }));
  }

  async function loadAccount() {
    try {
      const r = await getJSON("/api/auth/me");
      if (r.ok && r.body && r.body.authenticated && r.body.user) app.auth = { username: r.body.user.username || r.body.user.user_id || "player" };
      else app.auth = false;
    } catch (_) { app.auth = false; }
    if (app.auth) await loadMyStats();
    renderAccount();
  }
  async function loadMyStats() {
    if (!app.auth) return null;
    app.statsState = "loading";
    try {
      const r = await getJSON("/api/ludo/stats/me");
      if (r.ok && r.body) { app.myStats = r.body; app.statsState = "ok"; }
      else if (r.status === 401) { app.auth = false; app.myStats = null; app.statsState = "idle"; }
      else app.statsState = "error";
    } catch (_) { app.statsState = "error"; }
    return app.myStats;
  }

  // Start intents -------------------------------------------------------------
  function startIntent(intent) {
    if (app.awaiting) return;
    app.intent = intent;
    app.room = null;
    app.roomAfterMatch = false;
    switch (intent.kind) {
      case "bots":
        app.awaiting = "match";
        send({ type: "play_bots", mode: intent.mode, bots: intent.bots });
        break;
      case "quick":
        app.awaiting = "queue";
        app.queue = { humans: 1, startsAt: null, mode: intent.mode };
        showScreen("queue");
        renderQueue();
        send({ type: "quick_match", mode: intent.mode });
        break;
      case "create":
        app.awaiting = "lobby";
        send({ type: "create_room", mode: intent.mode, private: true });
        break;
      case "join":
        app.awaiting = "lobby";
        send({ type: "join_room", code: intent.code });
        break;
      default: break;
    }
    renderPlayButtons();
    clearTimeout(app.awaitTimer);
    app.awaitTimer = setTimeout(() => {
      if (!app.awaiting) return;
      app.awaiting = null;
      renderPlayButtons();
      if (app.screen === "queue" && !app.queue.startsAt && net.state !== "open") {
        toast("Couldn’t reach the game server. Try again in a moment.", "error");
        showScreen("home");
      }
    }, 12000);
  }
  function clearAwaiting() { app.awaiting = null; clearTimeout(app.awaitTimer); renderPlayButtons(); }

  dom.btnPlayBots.addEventListener("click", () => startIntent({ kind: "bots", mode: app.mode, bots: app.bots }));
  dom.btnQuick.addEventListener("click", () => startIntent({ kind: "quick", mode: app.mode }));
  dom.btnCreate.addEventListener("click", () => startIntent({ kind: "create", mode: app.mode }));
  dom.joinCode.addEventListener("input", () => { dom.joinCode.value = normCode(dom.joinCode.value); });
  dom.joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = normCode(dom.joinCode.value);
    if (code.length < 4) { toast("Room codes are 4 characters long.", "error"); dom.joinCode.focus(); return; }
    startIntent({ kind: "join", code });
  });

  // ---------------------------------------------------------------------------
  // Queue screen
  // ---------------------------------------------------------------------------
  let queueTimer = null;
  function renderQueue() {
    const q = app.queue || { humans: 1 };
    const modeName = (q.mode || app.mode) === "classic" ? "Classic" : "Power";
    dom.queueMode.textContent = modeName + " mode · Quick Match";
    dom.queueSlots.innerHTML = "";
    const humans = clamp(num(q.humans, 1), 1, 4);
    for (let i = 0; i < 4; i++) {
      const filled = i < humans;
      dom.queueSlots.appendChild(h("span", { class: "q-slot " + (filled ? "filled seat-" + SEAT_COLOR[i] : "empty") },
        h("span", { class: "q-slot-icon", text: filled ? "🙂" : "?" })));
    }
    updateQueueInfo();
    clearInterval(queueTimer);
    queueTimer = setInterval(() => { if (app.screen !== "queue") { clearInterval(queueTimer); return; } updateQueueInfo(); }, 250);
  }
  function updateQueueInfo() {
    const q = app.queue || {};
    const humans = clamp(num(q.humans, 1), 1, 4);
    let txt = humans === 1 ? "Just you so far" : humans + " players waiting";
    if (q.startsAt) {
      const s = Math.max(0, Math.ceil((q.startsAt - Date.now()) / 1000));
      txt += s > 0 ? " · starting in " + s + "s" : " · starting…";
      dom.queueTitle.textContent = s > 0 ? "Finding players…" : "Starting match…";
    } else if (net.state !== "open") {
      txt = "Connecting to the game server…";
    }
    dom.queueInfo.textContent = txt;
  }
  dom.btnCancelQueue.addEventListener("click", () => {
    send({ type: "cancel_queue" });
    app.queue = null;
    app.intent = null;
    clearAwaiting();
    showScreen("home");
  });

  // ---------------------------------------------------------------------------
  // Lobby screen
  // ---------------------------------------------------------------------------
  function inviteUrl(code) { return location.origin + "/arcade/ludo/?room=" + encodeURIComponent(code); }

  function renderLobby() {
    const r = app.room;
    if (!r) return;
    const me = r.you_seat;
    const isHost = me != null && me === r.host_seat;
    dom.roomCode.textContent = r.code || "----";
    dom.lobbyMode.textContent = r.mode === "classic" ? "🎲 Classic" : "⚡ Power";
    dom.lobbyMode.dataset.mode = r.mode || "power";
    dom.inviteLink.value = inviteUrl(r.code || "");
    const seats = Array.isArray(r.seats) ? r.seats : [];
    const reserved = Array.isArray(r.reserved) ? r.reserved : [];
    const occupied = seats.filter(Boolean).length;
    dom.seatGrid.innerHTML = "";
    for (let i = 0; i < 4; i++) {
      const s = seats[i] || null;
      const mine = me === i;
      const card = h("div", { class: "seat-card seat-" + SEAT_COLOR[i] + (s ? " taken" : " open") + (mine ? " mine" : ""), role: "group", "aria-label": SEAT_LABEL[i] + " seat" });
      const head = h("div", { class: "seat-head" },
        h("span", { class: "seat-swatch", "aria-hidden": "true" }),
        h("span", { class: "seat-colour", text: SEAT_LABEL[i] }));
      if (s && i === r.host_seat) head.appendChild(h("span", { class: "tag tag-host", text: "Host" }));
      if (mine) head.appendChild(h("span", { class: "tag tag-you", text: "You" }));
      card.appendChild(head);
      const bodyEl = h("div", { class: "seat-body" });
      if (s) {
        const isBot = s.kind === "bot";
        const av = isBot ? "🤖" : (s.avatar_url ? h("img", { src: s.avatar_url, alt: "" }) : initials(s.name));
        if (isBot) bodyEl.appendChild(h("span", { class: "seat-avatar bot" }, av));
        else {
          const btn = h("button", { type: "button", class: "seat-avatar seat-avatar-btn", "aria-label": (s.name || "Player") + " — player menu", "aria-haspopup": "dialog" }, av);
          btn.addEventListener("click", () => openPodMenu(i, btn.getBoundingClientRect(), "lobby", btn));
          bodyEl.appendChild(btn);
        }
        bodyEl.appendChild(h("div", { class: "seat-who" },
          h("span", { class: "seat-name", text: s.name || "Player" }),
          h("span", { class: "seat-kind", text: isBot ? "Bot" : s.kind === "guest" ? "Guest" : ("@" + (s.username || "player")) })));
        const hostSeat = i === r.host_seat;
        const ready = isBot || hostSeat || !!s.ready;
        bodyEl.appendChild(h("span", { class: "ready-pill " + (ready ? "on" : "off"), text: ready ? "Ready" : "Not ready" }));
      } else if (reserved.includes(i)) {
        bodyEl.appendChild(h("span", { class: "seat-avatar empty", "aria-hidden": "true", text: "⏳" }));
        bodyEl.appendChild(h("div", { class: "seat-who" },
          h("span", { class: "seat-name muted", text: "Held seat" }),
          h("span", { class: "seat-kind", text: "Kept for last game’s player (2 min)" })));
      } else {
        bodyEl.appendChild(h("span", { class: "seat-avatar empty", "aria-hidden": "true", text: "+" }));
        bodyEl.appendChild(h("div", { class: "seat-who" },
          h("span", { class: "seat-name muted", text: "Empty seat" }),
          h("span", { class: "seat-kind", text: "Waiting for a player" })));
      }
      card.appendChild(bodyEl);
      const acts = h("div", { class: "seat-actions" });
      if (!s && reserved.includes(i)) {
        /* held for a previous player: nothing to do here */
      } else if (!s) {
        if (!mine) acts.appendChild(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => send({ type: "pick_seat", seat: i }) }, "Sit here"));
        if (isHost) acts.appendChild(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => send({ type: "add_bot", seat: i }) }, "＋ Add bot"));
      } else if (s.kind === "bot" && isHost) {
        acts.appendChild(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => send({ type: "remove_bot", seat: i }) }, "Remove bot"));
      }
      if (acts.children.length) card.appendChild(acts);
      dom.seatGrid.appendChild(card);
    }
    const mySeat = me != null ? seats[me] : null;
    const myReady = !!(mySeat && mySeat.ready);
    dom.btnReady.setAttribute("aria-pressed", myReady ? "true" : "false");
    dom.btnReady.textContent = myReady ? "✓ Ready" : "I’m ready";
    dom.btnReady.classList.toggle("is-ready", myReady);
    dom.btnReady.disabled = me == null;
    dom.btnReady.classList.toggle("hidden", isHost);
    dom.btnStart.classList.toggle("hidden", !isHost);
    dom.btnStart.disabled = !r.can_start;
    let hint;
    if (isHost) {
      if (r.can_start) hint = "Everyone’s ready — start whenever you like.";
      else if (occupied < 2) hint = "You need at least 2 players. Share the invite link or add a bot.";
      else hint = "Waiting for the other players to press Ready.";
    } else {
      hint = myReady ? "Waiting for the host to start the game…" : "Press Ready when you’re set.";
    }
    dom.lobbyHint.textContent = hint;
    updateHeaderStatus();
  }

  dom.btnReady.addEventListener("click", () => {
    const r = app.room; if (!r || r.you_seat == null) return;
    const s = (r.seats || [])[r.you_seat];
    send({ type: "set_ready", ready: !(s && s.ready) });
  });
  dom.btnStart.addEventListener("click", () => { app.awaiting = "match"; send({ type: "start" }); });
  dom.btnLeaveLobby.addEventListener("click", () => {
    send({ type: "leave" });
    app.room = null;
    app.intent = null;
    clearChat();
    setRoomParam(null);
    showScreen("home");
  });
  dom.btnCopyInvite.addEventListener("click", async () => {
    const url = dom.inviteLink.value;
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (_) {
      try { dom.inviteLink.select(); ok = document.execCommand("copy"); } catch (__) { ok = false; }
    }
    if (ok) { dom.btnCopyInvite.textContent = "Copied ✓"; setTimeout(() => { dom.btnCopyInvite.textContent = "Copy link"; }, 1800); }
    else toast("Couldn’t copy — select the link and copy it manually.", "error");
  });
  dom.inviteLink.addEventListener("focus", () => dom.inviteLink.select());

  function setRoomParam(code) {
    const u = new URL(location.href);
    if (code) u.searchParams.set("room", code); else u.searchParams.delete("room");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
  }

  // ---------------------------------------------------------------------------
  // Network client
  // ---------------------------------------------------------------------------
  const net = {
    ws: null, state: "idle", welcomed: false, outbox: [], attempt: 0,
    retryTimer: null, pingTimer: null, lastRx: 0, manualClose: false,
    resuming: false, resumeTimer: null, helloName: "",
  };

  function readResume() {
    const r = ssGet(SS_RESUME);
    return r && r.match_id && r.seat_token ? r : null;
  }
  function clearResume() { ssDel(SS_RESUME); }

  function needsConnection() {
    return app.screen === "queue" || app.screen === "lobby" || app.screen === "game"
      || !!readResume() || net.outbox.length > 0 || !!app.awaiting;
  }

  function setNetState(s) { net.state = s; updateNetUI(); }
  function updateNetUI() {
    const labels = { idle: "Offline", connecting: "Connecting", open: "Online", reconnecting: "Reconnecting" };
    dom.netPill.dataset.state = net.state;
    dom.netPillText.textContent = labels[net.state] || "Offline";
    const show = net.state === "reconnecting" && (app.screen === "queue" || app.screen === "lobby" || app.screen === "game");
    dom.netBanner.classList.toggle("hidden", !show);
    dom.body.classList.toggle("is-reconnecting", show);
    if (show) dom.netBannerText.textContent = app.screen === "game"
      ? "Connection lost — reconnecting… a bot keeps your seat warm."
      : "Connection lost — reconnecting…";
  }

  function connect() {
    if (net.ws && (net.ws.readyState === WebSocket.CONNECTING || net.ws.readyState === WebSocket.OPEN)) return;
    clearTimeout(net.retryTimer);
    net.manualClose = false;
    net.welcomed = false;
    setNetState(net.attempt > 0 ? "reconnecting" : "connecting");
    let ws;
    try { ws = new WebSocket(WS_URL); } catch (_) { scheduleReconnect(); return; }
    net.ws = ws;
    ws.addEventListener("open", () => {
      if (net.ws !== ws) return;
      net.lastRx = Date.now();
      const hello = { type: "hello", name: guestName() };
      const res = readResume();
      if (res) {
        hello.resume = { match_id: res.match_id, seat_token: res.seat_token };
        net.resuming = true;
      }
      net.helloName = hello.name;
      rawSend(ws, hello);
      startPing();
    });
    ws.addEventListener("message", (ev) => {
      if (net.ws !== ws) return;
      net.lastRx = Date.now();
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (!msg || typeof msg !== "object") return;
      try { onMessage(msg); } catch (err) { console.warn("[ludo] message handler failed", msg.type, err); }
    });
    ws.addEventListener("close", () => onSocketClosed(ws));
    ws.addEventListener("error", () => { /* close event follows */ });
  }

  function onSocketClosed(ws) {
    if (net.ws !== ws) return;
    net.ws = null;
    net.welcomed = false;
    stopPing();
    if (net.manualClose) { setNetState("idle"); return; }
    if (needsConnection()) scheduleReconnect();
    else setNetState("idle");
  }

  function scheduleReconnect() {
    clearTimeout(net.retryTimer);
    net.attempt += 1;
    const base = Math.min(10000, 600 * Math.pow(2, Math.min(net.attempt - 1, 5)));
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    setNetState("reconnecting");
    net.retryTimer = setTimeout(connect, delay);
  }

  function disconnect() {
    net.manualClose = true;
    clearTimeout(net.retryTimer);
    stopPing();
    const ws = net.ws;
    net.ws = null;
    net.welcomed = false;
    if (ws) { try { ws.close(); } catch (_) { /* ignore */ } }
    setNetState("idle");
  }

  function rawSend(ws, msg) {
    try { ws.send(JSON.stringify(msg)); return true; } catch (_) { return false; }
  }
  function send(msg) {
    if (net.welcomed && net.ws && net.ws.readyState === WebSocket.OPEN) {
      if (rawSend(net.ws, msg)) return true;
    }
    net.outbox.push(msg);
    connect();
    return false;
  }
  function flushOutbox() {
    const out = net.outbox.splice(0);
    out.forEach((m) => rawSend(net.ws, m));
  }

  function startPing() {
    stopPing();
    net.pingTimer = setInterval(() => {
      const ws = net.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - net.lastRx > STALE_MS) {
        // Dead connection: drop it and reconnect.
        try { ws.close(); } catch (_) { /* ignore */ }
        onSocketClosed(ws);
        return;
      }
      rawSend(ws, { type: "ping" });
    }, PING_MS);
  }
  function stopPing() { clearInterval(net.pingTimer); net.pingTimer = null; }

  window.addEventListener("online", () => { if (!net.ws && needsConnection()) { net.attempt = Math.max(net.attempt, 1); connect(); } });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = baseTitle;
      if (!net.ws && needsConnection()) connect();
    }
  });

  // ---------------------------------------------------------------------------
  // Server messages
  // ---------------------------------------------------------------------------
  function onMessage(m) {
    switch (m.type) {
      case "welcome": return onWelcome(m);
      case "error": return onServerError(m);
      case "queue_status": return onQueueStatus(m);
      case "room_update": return onRoomUpdate(m);
      case "match_start": return onMatchStart(m);
      case "events": return onEvents(m);
      case "emote": return onEmote(m);
      case "player_status": return onPlayerStatus(m);
      case "match_end": return onMatchEnd(m);
      case "room_closed": return onRoomClosed(m);
      case "chat": return onChat(m);
      case "throw": return onThrow(m);
      case "continue_prompt": return onContinuePrompt(m);
      case "continue_status": return onContinueStatus(m);
      case "pong": return undefined;
      default: return undefined;
    }
  }

  function onWelcome(m) {
    const wasReconnect = net.attempt > 0;
    net.welcomed = true;
    net.attempt = 0;
    app.welcome = m;
    setNetState("open");
    if (m.user && app.auth === false) { app.auth = { username: m.user.username }; loadMyStats().then(renderAccount); }

    // Re-establish whatever we were doing before the drop.
    if (wasReconnect && !net.resuming) {
      if (app.screen === "lobby" && app.room && app.room.code) net.outbox.unshift({ type: "join_room", code: app.room.code });
      else if (app.screen === "queue" && app.intent && app.intent.kind === "quick") net.outbox.unshift({ type: "quick_match", mode: app.intent.mode });
      else if (app.screen === "game" && app.match && !app.ended) {
        // Lost our resume token somehow — nothing to restore.
        toast("Couldn’t rejoin the match.", "error");
        leaveMatchUI();
      }
    }
    if (net.resuming) {
      clearTimeout(net.resumeTimer);
      net.resumeTimer = setTimeout(() => { if (net.resuming) resumeFailed(); }, 6000);
    }
    flushOutbox();
  }

  function resumeFailed(message) {
    net.resuming = false;
    clearTimeout(net.resumeTimer);
    clearResume();
    if (app.screen === "game" || app.match) {
      if (!app.ended) toast(message || "That match has ended.", "info");
      if (!app.resultsShown) leaveMatchUI();
    }
    if (app.pendingRoom) { const code = app.pendingRoom; app.pendingRoom = null; startIntent({ kind: "join", code }); }
  }

  function onServerError(m) {
    const msg = FRIENDLY_ERRORS[m.code] || m.message || m.code || "Something went wrong.";
    if (net.resuming) { resumeFailed(m.code === "resume_failed" ? null : msg); return; }
    if (app.again && ["not_in_match", "not_finished", "room_in_progress", "room_full", "busy"].includes(m.code)) { againFallback(m.code, msg); return; }
    if (SOCIAL_ERRORS.has(m.code)) {
      toast(msg, "info", 2200);
      if (m.code === "no_prompt" || m.code === "already_answered") closeContinue();
      if (m.code === "paused") { setPending(false); if (app.screen === "game") updateGameUI(); }
      return;
    }
    if (app.syncing) { app.syncing = false; if (m.code === "not_in_match") return; }
    setPending(false);
    const wasAwaiting = app.awaiting;
    clearAwaiting();
    if (wasAwaiting === "queue" && app.screen === "queue") showScreen("home");
    if (wasAwaiting === "lobby" && app.screen !== "lobby") {
      setRoomParam(null);
      if (app.screen !== "home") showScreen("home");
    }
    toast(msg, "error");
    if (app.screen === "game") updateGameUI();
  }

  function onQueueStatus(m) {
    // Quick-match "play again" re-queues: leave the results for the queue screen.
    if (app.again && (app.again.kind === "quick" || !app.again.kind) && m.in_queue !== false) {
      clearAgain();
      resetMatchState();
      app.queue = { humans: 1, startsAt: null, mode: m.mode || app.mode };
      showScreen("queue");
    }
    // We switch to the queue screen as soon as Quick Match is pressed, so any
    // status that arrives elsewhere (e.g. the ack of cancel_queue) is stale.
    if (app.screen !== "queue") return;
    if (m.in_queue === false) {
      clearAwaiting();
      app.queue = null;
      showScreen("home");
      return;
    }
    clearAwaiting();
    const startsIn = m.starts_in_ms == null ? null : num(m.starts_in_ms, null);
    app.queue = {
      humans: num(m.humans_waiting, 1),
      startsAt: startsIn == null ? null : Date.now() + startsIn,
      mode: m.mode || (app.intent && app.intent.mode) || app.mode,
    };
    app.awaiting = "match";
    renderQueue();
  }

  function onRoomUpdate(m) {
    app.room = m;
    if (Array.isArray(m.chat_history)) setChatHistory(m.chat_history);
    let fromAgain = false;
    if (app.again && app.again.kind !== "quick") {
      // play_again in a private room: back to the SAME lobby (code, seats, bots, chat).
      clearAgain();
      resetMatchState();
      fromAgain = true;
    }
    if (!fromAgain && (app.screen === "game" || app.resultsShown)) {
      // The room survived the match: offer to go back to it.
      if (app.ended || app.resultsShown) { app.roomAfterMatch = true; renderResultsActions(); }
      return;
    }
    clearAwaiting();
    // "Play again" from a room match creates a fresh room in the same mode.
    if (!app.intent || (app.intent.kind !== "join" && app.intent.kind !== "create")) app.intent = { kind: "join", code: m.code };
    setRoomParam(m.code);
    if (app.screen !== "lobby") showScreen("lobby");
    renderLobby();
  }

  function onRoomClosed(m) {
    const code = String(m.reason || "");
    if (code === "left") return; // ack of our own `leave`
    if (code === "replaced") {
      // This seat was resumed from another tab/device: don't fight over it.
      clearResume();
      if (app.screen === "game" && !app.resultsShown) { toast("This match is now open in another tab.", "info", 6000); leaveMatchUI(); }
      return;
    }
    if (app.screen === "game" && app.match && !app.ended) {
      // Match aborted by the server (error / runaway timeout): nothing was recorded.
      clearResume();
      toast("The match was stopped by the server" + (code ? " (" + code.replace(/_/g, " ") + ")" : "") + ". It wasn’t recorded.", "error", 7000);
      leaveMatchUI();
      return;
    }
    const reason = code === "stale" ? "inactive for too long" : code.replace(/_/g, " ");
    app.room = null;
    if (app.screen === "lobby" || app.screen === "queue") clearChat();
    app.roomAfterMatch = false;
    renderResultsActions();
    if (app.screen === "lobby" || app.screen === "queue") {
      toast("Room closed" + (reason ? ": " + reason : "") + ".", "info");
      setRoomParam(null);
      clearAwaiting();
      showScreen("home");
    }
  }

  function onMatchStart(m) {
    if (!m || !m.state) return;
    const sameMatch = !!(app.match && app.match.match_id === m.match_id);
    const resumed = net.resuming || sameMatch;
    const quiet = app.syncing && sameMatch;
    app.syncing = false;
    net.resuming = false;
    clearTimeout(net.resumeTimer);
    clearAwaiting();
    app.pendingRoom = null;
    const youSeat = num(m.you_seat != null ? m.you_seat : (m.you && m.you.seat), 0);
    const token = m.seat_token || (readResume() || {}).seat_token || (app.match && app.match.seat_token);
    const prevScope = muteScope();
    app.startState = m.state;
    clearAgain();
    app.match = { match_id: m.match_id, you_seat: youSeat, seat_token: token, mode: m.state.mode || "power", started: Date.now() };
    carryMutes(prevScope, muteScope());
    if (!sameMatch) closeContinue();
    if (Array.isArray(m.chat_history)) setChatHistory(m.chat_history);
    else if (!sameMatch && !(app.room && app.screen === "lobby")) clearChat();
    if (m.match_id && token) ssSet(SS_RESUME, { match_id: m.match_id, seat_token: token, you_seat: youSeat });
    setRoomParam(null);
    app.gen += 1;
    anim.queue.length = 0;
    anim.queue.push({ kind: "start", msg: m, resumed, quiet, gen: app.gen });
    pump();
  }

  function onEvents(m) {
    if (!app.match || !m.state) return;
    if (m.state.match_id && app.match.match_id && m.state.match_id !== app.match.match_id) return;
    let gap = false;
    if (typeof m.seq === "number") {
      if (app.lastSeq != null && m.seq <= app.lastSeq) return; // duplicate after a resume
      gap = app.lastSeq != null && m.seq > app.lastSeq + 1;
      app.lastSeq = m.seq;
    }
    setPending(false);
    const item = { kind: "events", msg: m, deadline: computeDeadline(m.state.turn), gen: app.gen, play: null };
    // Hand the batch to the renderer right away: it plays jobs strictly in order
    // and speeds up / skips effects when several are queued, so a backlog (fast
    // bots, a backgrounded tab) catches up instead of eating the player's timer.
    // If a match_start snapshot is still waiting to be applied, dispatch later.
    if (renderer && !anim.queue.some((q) => q.kind === "start")) dispatchPlay(item);
    anim.queue.push(item);
    pump();
    if (gap) requestSync(); // we missed a batch: ask for a fresh snapshot
  }

  function onEmote(m) {
    if (!renderer || m.seat == null) return;
    try { renderer.showEmote(m.seat, m.emote); } catch (_) { /* ignore */ }
    if (!RENDERER_HANDLES_SFX) Sfx.play("emote");
  }

  function onPlayerStatus(m) {
    if (m.seat == null) return;
    const patch = (st) => {
      if (!st || !Array.isArray(st.seats) || !st.seats[m.seat]) return;
      st.seats[m.seat] = Object.assign({}, st.seats[m.seat], { connected: !!m.connected, autopilot: !!m.autopilot, left: !!m.left || !!st.seats[m.seat].left });
    };
    patch(app.shownState);
    anim.queue.forEach((q) => { if (q.msg && q.msg.state) patch(q.msg.state); });
    if (!anim.running && renderer && app.shownState) {
      try { renderer.setState(app.shownState); } catch (_) { /* ignore */ }
      updateGameUI();
    }
    if (app.match && m.seat !== app.match.you_seat && app.shownState) {
      const name = seatName(m.seat, app.shownState, false);
      const prev = app.seatStatus[m.seat] || {};
      const resignedNow = !!(((app.shownState && app.shownState.players) || [])[m.seat] || {}).resigned;
      if (m.left && !prev.left && !resignedNow) logLine(m.seat, name + " left — autopilot is playing their seat", "muted");
      else if (!m.left && !m.connected && prev.connected !== false) logLine(m.seat, name + " disconnected — autopilot is filling in", "muted");
      else if (m.connected && prev.connected === false) logLine(m.seat, name + " is back", "muted");
      app.seatStatus[m.seat] = { connected: !!m.connected, left: !!m.left };
    }
  }

  function onMatchEnd(m) {
    app.ended = m;
    clearResume();
    if (!anim.running && !anim.queue.length) finishMatch();
    // Safety net in case an animation never settles.
    setTimeout(() => { if (app.ended === m && !app.resultsShown) finishMatch(true); }, ANIM_TIMEOUT_MS + 4000);
  }

  // ---------------------------------------------------------------------------
  // Renderer management
  // ---------------------------------------------------------------------------
  let RENDERER_HANDLES_SFX = false;
  const reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function ensureRenderer(viewSeat) {
    if (renderer) return renderer;
    const R = (typeof window.LudoRenderer === "function") ? window.LudoRenderer : FallbackRenderer;
    RENDERER_HANDLES_SFX = R !== FallbackRenderer;
    dom.boardHost.innerHTML = "";
    renderer = new R(dom.boardHost, { viewSeat, reducedMotion });
    renderer.on("token", onBoardToken);
    renderer.on("square", (d) => { if (d && app.targeting) pickTarget("square", num(d.abs, -1)); });
    renderer.on("seat", (d) => { if (d && app.targeting) pickTarget("seat", num(d.seat, -1)); });
    renderer.on("pod", (d) => {
      if (!d || app.targeting) return; // seat targeting (Freeze) uses pod clicks
      const seat = num(d.seat, -1);
      const rect = typeof renderer.getPodRect === "function" ? renderer.getPodRect(seat) : null;
      openPodMenu(seat, rect, "game", dom.boardHost.querySelector('.lr-pod[data-seat="' + seat + '"]'));
    });
    renderer.on("dice", (d) => {
      if (app.targeting || !canInteract()) { updateGameUI(); return; }
      const L = legal();
      if (d && d.value != null && L.choose.includes(num(d.value, 0))) sendAction({ type: "choose_die", value: num(d.value, 0) });
      else if (L.roll) sendAction({ type: "roll" });
      else updateGameUI();
    });
    return renderer;
  }

  function teardownRenderer() {
    if (renderer) { try { renderer.destroy(); } catch (_) { /* ignore */ } }
    renderer = null;
    dom.boardHost.innerHTML = "";
  }

  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { if (renderer && renderer.resize) { try { renderer.resize(); } catch (_) { /* ignore */ } } });
  });

  // ---------------------------------------------------------------------------
  // Event queue: every server batch is animated in order, never dropped.
  // ---------------------------------------------------------------------------
  function dispatchPlay(item) {
    if (item.play) return item.play;
    const m = item.msg;
    try {
      item.play = Promise.resolve(renderer.playEvents(Array.isArray(m.events) ? m.events : [], m.state));
    } catch (err) {
      item.play = Promise.reject(err);
    }
    item.play.catch(() => { /* handled in pump */ });
    return item.play;
  }

  async function pump() {
    if (anim.running) return;
    anim.running = true;
    try {
      while (anim.queue.length) {
        const item = anim.queue.shift();
        if (item.gen !== app.gen) continue;
        if (item.kind === "start") { applyMatchStart(item.msg, item.resumed, item.quiet); continue; }
        const m = item.msg;
        if (!renderer) { ensureRenderer(app.match ? app.match.you_seat : 0); }
        // Dispatch any batches queued behind a match_start that we just applied.
        anim.queue.forEach((q) => { if (q.kind === "events" && q.gen === app.gen && !q.play && !anim.queue.slice(0, anim.queue.indexOf(q)).some((x) => x.kind === "start")) dispatchPlay(q); });
        logEvents(m.events || [], m.state);
        lockBoard();
        try {
          await withTimeout(dispatchPlay(item), ANIM_TIMEOUT_MS);
        } catch (err) {
          if (err && err.message !== "timeout") console.warn("[ludo] playEvents failed", err);
          try { renderer && renderer.setState(m.state); } catch (_) { /* ignore */ }
          requestSync();
        }
        if (item.gen !== app.gen) continue;
        app.shownState = m.state;
        app.you = m.you || { seat: app.match ? app.match.you_seat : null, legal_actions: [] };
        app.deadline = item.deadline;
        // Keep the side panel in step with the board while a backlog drains
        // (inputs stay locked; the renderer is left alone mid-animation).
        if (anim.queue.length && app.screen === "game") updateGameUI({ board: false });
      }
    } finally {
      anim.running = false;
    }
    if (app.screen === "game") updateGameUI();
    if (app.ended && !app.resultsShown && !anim.queue.length) finishMatch();
  }

  function applyMatchStart(m, resumed, quiet) {
    hideResults();
    app.ended = null;
    app.resultsShown = false;
    app.roomAfterMatch = false;
    app.lastSeq = typeof m.seq === "number" ? m.seq : null;
    app.cueKey = "";
    cancelTargeting(true);
    setPending(false);
    closeEmotes();
    if (app.screen !== "game") showScreen("game");
    const seat = app.match.you_seat;
    ensureRenderer(seat);
    try { renderer.setViewSeat(seat); } catch (_) { /* ignore */ }
    try { renderer.setState(m.state); } catch (err) { console.warn("[ludo] setState failed", err); }
    app.shownState = m.state;
    app.you = m.you || { seat, legal_actions: [] };
    app.deadline = computeDeadline(m.state.turn);
    if (!resumed) {
      dom.eventLog.innerHTML = "";
      setLogExpanded(false);
      const n = (m.state.active_seats || []).length || 4;
      logLine(seat, "Match started — you are " + SEAT_LABEL[seat] + ". Good luck!", "system");
      dom.matchMeta.textContent = (m.state.mode === "classic" ? "Classic" : "Power") + " · " + n + " players";
      announce("Match started. You are " + SEAT_LABEL[seat] + ".");
    } else if (!quiet) {
      if (!dom.eventLog.children.length) dom.matchMeta.textContent = (m.state.mode === "classic" ? "Classic" : "Power") + " · " + ((m.state.active_seats || []).length || 4) + " players";
      logLine(seat, "Reconnected to the match.", "system");
      toast("Reconnected — you’re back in control.", "ok", 2600);
    }
    app.seatStatus = {};
    (m.state.seats || []).forEach((x, i) => { if (x) app.seatStatus[i] = { connected: x.connected !== false, left: !!x.left }; });
    updateGameUI();
    if (m.state.status && m.state.status !== "playing" && !app.ended) {
      // Resumed into a match that already ended — nothing to do but leave.
      clearResume();
    }
  }

  // Ask the server for a fresh snapshot (answers with match_start for our match).
  let lastSyncAt = 0;
  function requestSync() {
    if (!app.match || Date.now() - lastSyncAt < 3000) return;
    lastSyncAt = Date.now();
    app.syncing = true;
    send({ type: "sync" });
  }

  function computeDeadline(turn) {
    if (!turn || !turn.deadline_ms) return null;
    const total = num(turn.turn_seconds, 20) * 1000;
    let remain = num(turn.deadline_ms, 0) - Date.now();
    if (remain > total + 3000 || remain < -total) remain = total; // client clock is off: assume fresh timer
    return Date.now() + Math.max(0, remain);
  }

  // ---------------------------------------------------------------------------
  // Game UI
  // ---------------------------------------------------------------------------
  function legal() {
    const out = { roll: false, moves: [], choose: [], pass: false, powers: {}, any: false };
    const list = (app.you && Array.isArray(app.you.legal_actions)) ? app.you.legal_actions : [];
    for (const a of list) {
      if (!a || !a.type) continue;
      if (a.type === "roll") out.roll = true;
      else if (a.type === "move") { if (!out.moves.includes(a.token)) out.moves.push(a.token); }
      else if (a.type === "choose_die") { if (!out.choose.includes(a.value)) out.choose.push(a.value); }
      else if (a.type === "pass") out.pass = true;
      else if (a.type === "use_power") (out.powers[a.power] = out.powers[a.power] || []).push(a);
      if (a.type !== "resign") out.any = true;
    }
    return out;
  }

  function isMyTurn() {
    const st = app.shownState;
    return !!(st && app.match && st.status === "playing" && st.turn && st.turn.seat === app.match.you_seat);
  }
  function canInteract() {
    return isMyTurn() && !anim.running && !anim.queue.length && !app.pending && legal().any;
  }

  function seatInfo(seat, st) { return ((st || app.shownState || {}).seats || [])[seat] || null; }
  function seatName(seat, st, youAware) {
    if (youAware !== false && app.match && seat === app.match.you_seat) return "You";
    const s = seatInfo(seat, st);
    return (s && s.name) || SEAT_LABEL[seat] || "Player";
  }

  function lockBoard(rolling) {
    if (!renderer) return;
    try {
      renderer.setSelectable([]);
      const st = app.shownState;
      if (st && st.turn) renderer.setDice({ seat: st.turn.seat, values: rolling ? [] : (st.turn.dice || []), phase: st.turn.phase, enabled: false, rolling: !!rolling });
    } catch (_) { /* ignore */ }
    dom.btnRoll.disabled = true;
    dom.chooseRow.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    dom.btnPass.disabled = true;
    dom.powerBar.querySelectorAll("button").forEach((b) => { b.disabled = true; });
  }

  function setPending(on) {
    app.pending = !!on;
    clearTimeout(app.pendingTimer);
    if (on) app.pendingTimer = setTimeout(() => { app.pending = false; if (app.screen === "game") updateGameUI(); }, ACTION_PENDING_MS);
  }

  function sendAction(action) {
    if (!action || app.pending) return;
    if (!canInteract() && action.type !== "resign") return;
    setPending(true);
    send({ type: "action", action });
    if (action.type !== "resign") lockBoard(action.type === "roll" || (action.type === "use_power" && action.power === "reroll"));
  }

  function updateGameUI(opts) {
    const boardToo = !(opts && opts.board === false);
    const st = app.shownState;
    if (!st || !app.match) return;
    const me = app.match.you_seat;
    const turn = st.turn || {};
    const playing = st.status === "playing";
    const L = legal();
    const mine = isMyTurn() && L.any;
    const interactive = canInteract();

    if (app.targeting && (!interactive || !L.powers[app.targeting.power])) cancelTargeting(true);
    const targeting = !!app.targeting;

    if (renderer && boardToo) {
      try {
        renderer.setDice({ seat: turn.seat, values: turn.dice || [], phase: turn.phase, enabled: interactive && (L.roll || L.choose.length > 0) && !targeting, rolling: false, boost: num(turn.boost, 0), double: !!turn.double_pending });
        renderer.setSelectable(interactive && !targeting ? L.moves.map((t) => ({ seat: me, token: t })) : []);
        const total = num(turn.turn_seconds, 20) * 1000;
        const onSeat = seatInfo(turn.seat, st);
        // Bots/autopilot act long before the deadline (it's only an upper bound): no ring for them.
        const humanClock = !!(onSeat && onSeat.kind !== "bot" && !onSeat.autopilot);
        if (playing && app.deadline && humanClock) renderer.setTimer(turn.seat, app.deadline, total);
        else renderer.setTimer(null);
      } catch (err) { console.warn("[ludo] renderer update failed", err); }
    }

    // Action buttons
    const choosing = L.choose.length > 0;
    dom.btnRoll.classList.toggle("hidden", choosing || (mine && !L.roll && (L.moves.length > 0 || L.pass)));
    dom.btnRoll.disabled = !(interactive && L.roll && !targeting);
    dom.btnRoll.classList.toggle("pulse", interactive && L.roll && !targeting);
    dom.chooseRow.classList.toggle("hidden", !choosing);
    if (choosing) {
      const key = L.choose.join(",");
      if (dom.chooseRow.dataset.key !== key) {
        dom.chooseRow.dataset.key = key;
        dom.chooseRow.innerHTML = "";
        dom.chooseRow.appendChild(h("span", { class: "choose-label", text: "Keep:" }));
        L.choose.slice().sort((a, b) => b - a).forEach((v) => {
          dom.chooseRow.appendChild(h("button", { type: "button", class: "btn btn-primary die-btn", "aria-label": "Keep the " + v, onclick: () => { Sfx.play("click"); sendAction({ type: "choose_die", value: v }); } },
            h("span", { class: "die-face", "data-v": String(v), text: String(v) })));
        });
      }
      dom.chooseRow.querySelectorAll("button").forEach((b) => { b.disabled = !interactive || targeting; });
    } else dom.chooseRow.dataset.key = "";
    dom.btnPass.classList.toggle("hidden", !L.pass);
    dom.btnPass.disabled = !interactive || targeting;

    // Turn card
    const seatOn = turn.seat;
    dom.turnCard.dataset.mine = mine ? "true" : "false";
    dom.turnCard.dataset.seat = seatOn != null ? SEAT_COLOR[seatOn] : "";
    dom.turnDot.className = "turn-dot" + (seatOn != null ? " seat-" + SEAT_COLOR[seatOn] : "");
    let title, sub = "";
    const paused = playing && turn.phase === "await_continue";
    const myPl = (st.players || [])[me] || {};
    const meDone = playing && (myPl.placement != null || !!myPl.retired);
    if (paused) {
      const w = (st.players || []).findIndex((p) => p && p.placement === 1);
      title = w >= 0 ? (w === me ? "You finished 1st! 🏆" : seatName(w, st) + " finished 1st") : "Paused";
      sub = app.prompt ? "Keep playing for the next places? Answer below." : "Waiting for players to decide whether to keep going…";
    } else if (!playing) {
      const w = st.winner;
      title = w == null ? "Match over" : (w === me ? "You won! 🏆" : seatName(w, st) + " won");
      sub = "Wrapping up…";
    } else if (mine) {
      title = "Your turn";
      if (targeting) sub = "Choose a target for " + powerMeta(app.targeting.power).name + ".";
      else if (choosing) sub = "Double Dice: pick which die to keep.";
      else if (turn.phase === "roll") sub = turn.double_pending ? "Double Dice ready — roll two dice and move the total!" : "Roll the dice — tap the dice or press Space.";
      else if (L.moves.length > 1) sub = "Rolled " + turnValue(turn) + ". Pick a glowing token (keys 1–4).";
      else if (L.moves.length === 1) sub = "Rolled " + turnValue(turn) + ". Tap the glowing token to move.";
      else if (L.pass) sub = "Rolled " + turnValue(turn) + ". No moves — use a power-up or pass.";
      else sub = "Waiting…";
      if (turn.boost) sub += " Rocket +" + turn.boost + " active.";
      if (app.pending) sub = "Sending…";
    } else {
      const s = seatInfo(seatOn, st);
      title = seatOn === me ? "Your turn" : (seatOn != null ? seatName(seatOn, st) : "Someone") + "’s turn";
      if (s && s.kind === "bot") sub = "Bot is thinking…";
      else if (s && s.connected === false) sub = "Disconnected — autopilot is playing.";
      else if (s && s.autopilot) sub = "On autopilot.";
      else sub = turn.phase === "move" && turn.value ? "Rolled " + turnValue(turn) + " — choosing a move…" : "Waiting for their move…";
    }
    dom.turnTitle.textContent = title;
    dom.turnSub.textContent = sub;
    const meInfo = seatInfo(me, st);
    const meResigned = !!myPl.resigned;
    const meRetired = !!myPl.retired;
    const meFinished = myPl.placement != null && !meRetired && !meResigned;
    const showNote = playing && (meResigned || meRetired || meFinished || (meInfo && meInfo.autopilot));
    dom.autopilotNote.classList.toggle("hidden", !showNote);
    if (showNote) dom.autopilotNote.textContent = meFinished
      ? "🏆 You finished " + ordinal(myPl.placement) + "! The others are playing on — watch, chat, or leave whenever you like."
      : meRetired ? "You stopped after the first finish — your tokens left the board. Watch the rest or leave whenever you like."
      : meResigned ? "🏳️ You resigned. Watch the rest of the match or leave whenever you like."
      : "🤖 Autopilot is playing for you. Tap Autopilot (or take any action) to get control back.";
    dom.powerHelp.classList.toggle("hidden", st.mode !== "power");
    syncMutedPods();

    renderPowerBar(st, L, interactive);
    updateClock();
    updateHeaderStatus();
    dom.btnResign.disabled = !playing || meResigned || meDone;
    const auto = !!(meInfo && meInfo.autopilot);
    dom.btnAuto.disabled = !playing || meResigned || meDone;
    dom.btnAuto.setAttribute("aria-pressed", auto ? "true" : "false");
    dom.autoLabel.textContent = auto ? "Bot on" : "Autopilot";

    // "Your turn" cue — once per turn.
    if (playing && mine && interactive) {
      const key = app.match.match_id + ":" + turn.number;
      if (app.cueKey !== key) {
        app.cueKey = key;
        if (!RENDERER_HANDLES_SFX) Sfx.play("turn");
        announce("Your turn. " + sub);
        dom.turnCard.classList.remove("cue"); void dom.turnCard.offsetWidth; dom.turnCard.classList.add("cue");
        if (document.hidden) document.title = "🎲 Your turn — Ludo";
        try { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(60); } catch (_) { /* ignore */ }
      }
    }
  }
  function turnValue(turn) {
    const v = num(turn.value, 0);
    const d = Array.isArray(turn.dice) ? turn.dice : [];
    const base = d.length === 2 && v === num(d[0], 0) + num(d[1], 0) ? d[0] + " + " + d[1] + " = " + v : String(v);
    return turn.boost ? base + " (+" + turn.boost + ")" : base;
  }

  function updateClock() {
    const st = app.shownState;
    const onSeat = st && st.turn ? seatInfo(st.turn.seat, st) : null;
    if (!st || st.status !== "playing" || !app.deadline || app.screen !== "game" || !onSeat || onSeat.kind === "bot" || onSeat.autopilot) { dom.turnClock.textContent = ""; return; }
    const remain = Math.max(0, app.deadline - Date.now());
    const s = Math.ceil(remain / 1000);
    dom.turnClock.textContent = s + "s";
    const mine = isMyTurn();
    dom.turnClock.classList.toggle("low", mine && s <= 5);
    if (!RENDERER_HANDLES_SFX && mine && canInteract() && s <= 5 && s > 0 && s !== app.tickSecond) { app.tickSecond = s; Sfx.play("tick"); }
  }
  setInterval(updateClock, 250);

  // Power-up bar --------------------------------------------------------------
  function renderPowerBar(st, L, interactive) {
    const power = st.mode === "power";
    dom.powerCard.classList.toggle("hidden", !power);
    if (!power) return;
    const me = app.match.you_seat;
    const pl = (st.players || [])[me] || {};
    const inv = Array.isArray(pl.inventory) ? pl.inventory : [];
    const used = !!(st.turn && st.turn.power_used && st.turn.seat === me);
    dom.powerUsedNote.classList.toggle("hidden", !used);
    const key = inv.join(",") + "|" + (app.targeting ? app.targeting.power : "");
    if (dom.powerBar.dataset.key !== key) {
      const focusedIdx = Array.from(dom.powerBar.children).indexOf(document.activeElement);
      dom.powerBar.dataset.key = key;
      dom.powerBar.innerHTML = "";
      for (let i = 0; i < 2; i++) {
        const p = inv[i];
        if (!p) {
          dom.powerBar.appendChild(h("div", { class: "power-slot empty" },
            h("span", { class: "pw-icon pw-empty", "aria-hidden": "true", text: "📦" }),
            h("span", { class: "power-slot-text" }, h("span", { class: "power-slot-name", text: "Empty slot" }), h("span", { class: "power-slot-desc", text: "Land on a crate" }))));
          continue;
        }
        const m = powerMeta(p);
        const active = app.targeting && app.targeting.power === p;
        const b = h("button", {
          type: "button", class: "power-slot power-btn" + (active ? " active" : ""), "data-power": p,
          style: { "--pw": m.color }, "aria-pressed": active ? "true" : "false",
          title: m.name + " — " + (m.description || ""),
          onclick: () => { Sfx.play("click"); onPowerClick(p); },
        }, powerIcon(p), h("span", { class: "power-slot-text" }, h("span", { class: "power-slot-name", text: m.name }), h("span", { class: "power-slot-desc", text: m.description || "" })));
        dom.powerBar.appendChild(b);
      }
      if (focusedIdx >= 0 && dom.powerBar.children[focusedIdx] && dom.powerBar.children[focusedIdx].focus) dom.powerBar.children[focusedIdx].focus();
    }
    dom.powerBar.querySelectorAll(".power-btn").forEach((b) => {
      const p = b.dataset.power;
      const ok = interactive && !!L.powers[p];
      const active = app.targeting && app.targeting.power === p;
      b.disabled = !(ok || active);
      b.classList.toggle("ready", ok && !active);
      const why = ok ? "" : (!isMyTurn() ? " (wait for your turn)" : used ? " (one power-up per turn)" : " (can’t be used right now)");
      b.setAttribute("aria-label", powerMeta(p).name + why);
    });
  }

  function onPowerClick(power) {
    if (app.targeting && app.targeting.power === power) { cancelTargeting(); return; }
    const acts = legal().powers[power];
    if (!acts || !acts.length || !canInteract()) return;
    if (power === "shield" || power === "freeze" || power === "bomb" || power === "swap") startTargeting(power, acts, 1, null);
    else sendAction(acts[0]);
  }

  // Targeting -------------------------------------------------------------------
  function tokenLabel(seat, token, st) {
    const p = num((((st || app.shownState || {}).tokens || [])[seat] || [])[token], -1);
    let where;
    if (p < 0) where = "in yard";
    else if (p === 0) where = "on start";
    else if (p >= 56) where = "home";
    else if (p >= 51) where = "home column";
    else where = (56 - p) + " to go";
    return "Token " + (token + 1) + " · " + where;
  }

  function startTargeting(power, acts, step, token) {
    const me = app.match.you_seat;
    const st = app.shownState;
    let spec, prompt;
    const options = [];
    if (power === "shield") {
      spec = { kind: "own_token", valid: acts.map((a) => ({ seat: me, token: a.token })) };
      prompt = "Shield which token? Tap a glowing token.";
      acts.forEach((a) => options.push({ label: tokenLabel(me, a.token, st), seat: me, onPick: () => pickTarget("token", me, a.token) }));
    } else if (power === "freeze") {
      spec = { kind: "seat", valid: acts.map((a) => a.target_seat) };
      prompt = "Freeze who? Their next turn is skipped.";
      acts.forEach((a) => options.push({ label: seatName(a.target_seat, st), seat: a.target_seat, onPick: () => pickTarget("seat", a.target_seat) }));
    } else if (power === "bomb") {
      spec = { kind: "square", valid: acts.map((a) => a.abs) };
      prompt = "Tap a glowing empty square to plant your bomb.";
    } else if (power === "swap" && step === 1) {
      const toks = Array.from(new Set(acts.map((a) => a.token)));
      spec = { kind: "own_token", valid: toks.map((t) => ({ seat: me, token: t })) };
      prompt = "Swap — first pick one of your tokens.";
      toks.forEach((t) => options.push({ label: tokenLabel(me, t, st), seat: me, onPick: () => pickTarget("token", me, t) }));
    } else if (power === "swap") {
      const sub = acts.filter((a) => a.token === token);
      spec = { kind: "opponent_token", valid: sub.map((a) => ({ seat: a.target_seat, token: a.target_token })) };
      prompt = "Now pick the rival token to trade places with.";
      sub.forEach((a) => options.push({ label: seatName(a.target_seat, st) + " · " + tokenLabel(a.target_seat, a.target_token, st), seat: a.target_seat, onPick: () => pickTarget("token", a.target_seat, a.target_token) }));
    }
    app.targeting = { power, acts, step, token, spec };
    if (renderer) {
      try { renderer.setSelectable([]); renderer.setTargeting(spec); } catch (_) { /* ignore */ }
    }
    dom.targetText.textContent = prompt;
    dom.targetOptions.innerHTML = "";
    if (power === "bomb") {
      const sel = h("select", { class: "ludo-input target-select", "aria-label": "Bomb square" });
      acts.slice().sort((a, b) => a.abs - b.abs).forEach((a) => sel.appendChild(h("option", { value: String(a.abs), text: squareLabel(a.abs, st) })));
      dom.targetOptions.appendChild(sel);
      dom.targetOptions.appendChild(h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => pickTarget("square", num(sel.value, -1)) }, "Plant bomb"));
    } else {
      options.forEach((o) => dom.targetOptions.appendChild(h("button", { type: "button", class: "target-opt seat-" + SEAT_COLOR[o.seat], onclick: o.onPick },
        h("span", { class: "dot", "aria-hidden": "true" }), o.label)));
    }
    dom.targetBar.classList.remove("hidden");
    dom.actionRow.classList.add("hidden");
    updateGameUI();
    const first = dom.targetOptions.querySelector("button, select");
    if (first && document.activeElement && dom.powerBar.contains(document.activeElement)) first.focus();
    announce(prompt);
  }

  function squareLabel(abs, st) {
    // Describe a track square relative to the nearest rival token behind it.
    const me = app.match ? app.match.you_seat : 0;
    let best = null;
    ((st && st.tokens) || []).forEach((toks, seat) => {
      if (seat === me) return;
      (toks || []).forEach((p) => {
        if (p < 0 || p > 50) return;
        const a = (seat * 13 + p) % 52;
        const d = (abs - a + 52) % 52;
        if (d > 0 && d <= 12 && (!best || d < best.d)) best = { d, seat };
      });
    });
    return "Square " + abs + (best ? " — " + best.d + " ahead of " + seatName(best.seat, st, false) : "");
  }

  function pickTarget(kind, a, b) {
    const t = app.targeting;
    if (!t || !app.match) return;
    const me = app.match.you_seat;
    let act = null;
    if (t.power === "shield" && kind === "token" && a === me) act = t.acts.find((x) => x.token === b);
    else if (t.power === "freeze" && kind === "seat") act = t.acts.find((x) => x.target_seat === a);
    else if (t.power === "bomb" && kind === "square") act = t.acts.find((x) => x.abs === a);
    else if (t.power === "swap" && kind === "token") {
      if (a === me && t.acts.some((x) => x.token === b)) { startTargeting("swap", t.acts, 2, b); return; }
      if (t.step === 2) act = t.acts.find((x) => x.token === t.token && x.target_seat === a && x.target_token === b);
    }
    if (!act) { announce("That target isn’t available."); return; }
    cancelTargeting(true);
    sendAction(act);
  }

  function cancelTargeting(silent) {
    if (!app.targeting) return;
    app.targeting = null;
    if (renderer) { try { renderer.setTargeting(null); } catch (_) { /* ignore */ } }
    dom.targetBar.classList.add("hidden");
    dom.targetOptions.innerHTML = "";
    dom.actionRow.classList.remove("hidden");
    if (!silent) { announce("Cancelled."); updateGameUI(); }
  }
  dom.btnCancelTarget.addEventListener("click", () => cancelTargeting());

  // Board/token clicks ------------------------------------------------------------
  function onBoardToken(d) {
    if (!d || !app.match) return;
    const seat = num(d.seat, -1), token = num(d.token, -1);
    if (app.targeting) { pickTarget("token", seat, token); return; }
    if (seat !== app.match.you_seat || !canInteract()) return;
    if (legal().moves.includes(token)) sendAction({ type: "move", token });
  }

  dom.btnRoll.addEventListener("click", () => { if (legal().roll) { Sfx.play("click"); sendAction({ type: "roll" }); } });
  dom.btnPass.addEventListener("click", () => { if (legal().pass) { Sfx.play("click"); sendAction({ type: "pass" }); } });

  // Emotes -------------------------------------------------------------------------
  EMOTES.forEach((e) => dom.emotePop.appendChild(h("button", { type: "button", class: "emote-btn", "aria-label": "Send " + e, onclick: () => sendEmote(e) }, e)));
  function openEmotes() {
    dom.emotePop.classList.remove("hidden");
    dom.btnEmote.setAttribute("aria-expanded", "true");
    const f = dom.emotePop.querySelector("button"); if (f) f.focus();
  }
  function closeEmotes(refocus) {
    if (dom.emotePop.classList.contains("hidden")) return;
    dom.emotePop.classList.add("hidden");
    dom.btnEmote.setAttribute("aria-expanded", "false");
    if (refocus) dom.btnEmote.focus();
  }
  dom.btnEmote.addEventListener("click", () => { if (dom.emotePop.classList.contains("hidden")) openEmotes(); else closeEmotes(); });
  document.addEventListener("click", (e) => {
    if (!dom.emotePop.classList.contains("hidden") && !e.target.closest(".emote-wrap")) closeEmotes();
  });
  function sendEmote(e) {
    const now = Date.now();
    closeEmotes(true);
    if (now < app.emoteReadyAt) { toast("Easy there — one emote every 2 seconds.", "info", 1800); return; }
    app.emoteReadyAt = now + 2000;
    send({ type: "emote", emote: e });
    dom.btnEmote.classList.add("cooldown");
    setTimeout(() => dom.btnEmote.classList.remove("cooldown"), 2000);
  }

  // Mute / resign / leave ------------------------------------------------------------
  function applyMute() {
    Sfx.setMuted(app.muted);
    dom.btnMute.setAttribute("aria-pressed", app.muted ? "true" : "false");
    dom.muteIcon.textContent = app.muted ? "🔇" : "🔊";
    dom.muteLabel.textContent = app.muted ? "Muted" : "Sound on";
  }
  dom.btnMute.addEventListener("click", () => { app.muted = !app.muted; lsSet(LS_KEYS.muted, app.muted ? "1" : "0"); applyMute(); });

  dom.btnAuto.addEventListener("click", () => {
    const me = app.match ? seatInfo(app.match.you_seat) : null;
    const on = !(me && me.autopilot);
    send({ type: "autopilot", on });
    announce(on ? "Autopilot on — a bot plays for you." : "Autopilot off — you’re back in control.");
  });

  dom.btnResign.addEventListener("click", async () => {
    const ok = await confirmDialog("Resign this match?", "Your tokens leave the board and you finish below everyone still playing.", "Resign");
    if (!ok) return;
    setPending(false);
    send({ type: "action", action: { type: "resign" } });
  });
  dom.btnLeaveGame.addEventListener("click", async () => {
    const st = app.shownState;
    const mePl = st && app.match ? ((st.players || [])[app.match.you_seat] || {}) : {};
    const done = mePl.placement != null || mePl.retired || mePl.resigned;
    if (st && st.status === "playing" && !done) {
      const ok = await confirmDialog("Leave the match?", "A bot takes over your seat for the rest of the game, and you still get a result at your final placement. To forfeit instead, use Resign.", "Leave match");
      if (!ok) return;
    }
    send({ type: "leave" });
    clearResume();
    leaveMatchUI();
  });

  function resetMatchState() {
    app.gen += 1;
    anim.queue.length = 0;
    app.match = null;
    app.shownState = null;
    app.ended = null;
    app.resultsShown = false;
    cancelTargeting(true);
    closeContinue();
    closePodMenu();
    hideResults();
  }
  function leaveMatchUI() {
    resetMatchState();
    clearAgain();
    clearChat();
    showScreen("home");
    renderAccount();
  }

  // ---------------------------------------------------------------------------
  // Event log (plain words)
  // ---------------------------------------------------------------------------
  function logLine(seat, text, kind) {
    const li = h("li", { class: "log-item" + (kind ? " log-" + kind : "") },
      h("span", { class: "log-dot" + (seat != null && seat >= 0 ? " seat-" + SEAT_COLOR[seat] : ""), "aria-hidden": "true" }),
      h("span", { class: "log-text", text }));
    dom.eventLog.insertBefore(li, dom.eventLog.firstChild);
    while (dom.eventLog.children.length > LOG_MAX) dom.eventLog.lastChild.remove();
    updateLogMore();
  }
  // Match log: only the latest line is visible; "Show more" reveals the rest.
  function updateLogMore() {
    const n = dom.eventLog.children.length;
    const open = dom.logCard.dataset.expanded === "true";
    dom.btnLogMore.classList.toggle("hidden", n <= 1);
    dom.btnLogMore.textContent = open ? "Show less" : "Show more (" + (n - 1) + ")";
    dom.btnLogMore.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function setLogExpanded(open) {
    dom.logCard.dataset.expanded = open ? "true" : "false";
    if (!open) dom.eventLog.scrollTop = 0;
    updateLogMore();
  }
  dom.btnLogMore.addEventListener("click", () => setLogExpanded(dom.logCard.dataset.expanded !== "true"));

  function logEvents(events, st) {
    const me = app.match ? app.match.you_seat : -1;
    const N = (s) => seatName(s, st);
    const obj = (s) => (s === me ? "you" : seatName(s, st));
    const poss = (s) => (s === me ? "Your" : seatName(s, st) + "’s");
    const possLower = (s) => (s === me ? "your" : seatName(s, st) + "’s");
    for (const ev of events) {
      if (!ev || !ev.type) continue;
      const s = ev.seat;
      let text = null, kind = null, say = null;
      switch (ev.type) {
        case "rolled": {
          const d = Array.isArray(ev.dice) ? ev.dice : [];
          text = d.length === 2
            ? N(s) + " rolled " + d[0] + " + " + d[1] + " = " + (ev.value != null ? ev.value : d[0] + d[1]) + (d[0] === 6 && d[1] === 6 ? " — double six!" : "")
            : N(s) + " rolled a " + (ev.value != null ? ev.value : d[0]);
          kind = "roll";
          break;
        }
        case "die_chosen": text = N(s) + " kept the " + ev.value; break;
        case "moved":
          if (ev.from === -1) text = N(s) + " brought a token out";
          else if (ev.boost) text = N(s) + " rocketed " + (Array.isArray(ev.path) ? ev.path.length : "") + " squares";
          break;
        case "captured":
          text = N(s) + " captured " + obj(ev.victim_seat) + " 🗡️"; kind = "big";
          if (ev.victim_seat === me) say = seatName(s, st) + " captured your token!";
          else if (s === me) say = "You captured " + seatName(ev.victim_seat, st) + "!";
          break;
        case "shield_blocked": text = poss(ev.victim_seat) + " shield blocked " + obj(s) + " 🛡️"; break;
        case "bomb_triggered":
          text = ev.defused ? poss(s) + " shield absorbed " + possLower(ev.bomb_seat) + " bomb 🛡️" : N(s) + " hit " + possLower(ev.bomb_seat) + " bomb 💥 — back to the yard";
          kind = ev.defused ? null : "big";
          break;
        case "crate_collected": text = N(s) + " found " + powerMeta(ev.power).name + " 📦"; if (s === me) say = "You found " + powerMeta(ev.power).name + "."; break;
        case "crate_full": text = poss(s) + " power-up slots are full"; break;
        case "power_used": {
          const t = ev.target || {};
          const name = powerMeta(ev.power).name;
          switch (ev.power) {
            case "freeze": text = N(s) + " froze " + obj(t.target_seat) + " ❄️"; if (t.target_seat === me) say = "You were frozen!"; break;
            case "swap": text = N(s) + " swapped places with " + obj(t.target_seat) + " 🌀"; break;
            case "shield": text = N(s) + " shielded a token 🛡️"; break;
            case "bomb": text = N(s) + " planted a bomb 💣"; break;
            case "boost": text = N(s) + " fired a Rocket (+3) 🚀"; break;
            case "reroll": text = N(s) + " used Re-roll 🔄"; break;
            case "double_dice": text = N(s) + " used Double Dice 🎲"; break;
            default: text = N(s) + " used " + name;
          }
          kind = "power";
          break;
        }
        case "turn_skipped":
          if (ev.reason === "frozen") text = N(s) + (s === me ? " are" : " is") + " frozen — turn skipped ❄️";
          else if (ev.reason === "three_sixes") text = "Three 6s in a row — " + possLower(s) + " turn is void";
          else if (ev.reason === "no_moves") text = N(s) + " couldn’t move";
          else if (ev.reason === "pass") text = N(s) + " passed";
          kind = "muted";
          break;
        case "shield_expired": text = poss(s) + " shield wore off"; kind = "muted"; break;
        case "token_finished": {
          const pl = ((st && st.players) || [])[s];
          text = N(s) + " got a token home 🏠" + (pl && pl.finished_tokens != null ? " (" + pl.finished_tokens + "/4)" : "");
          kind = "good";
          if (s === me) say = "Token home!";
          break;
        }
        case "extra_turn": {
          const why = (Array.isArray(ev.reasons) ? ev.reasons : []).map((r) => ({ six: "rolled a 6", capture: "captured", finish: "got a token home" }[r] || r));
          text = N(s) + (s === me ? " get" : " gets") + " another roll" + (why.length ? " (" + why.join(", ") + ")" : "");
          kind = "muted";
          break;
        }
        case "resigned": text = N(s) + " resigned 🏳️"; kind = "muted"; break;
        case "seat_finished": {
          const pl = num(ev.placement, 0);
          text = N(s) + " finished " + (pl ? ordinal(pl) : "") + (pl === 1 ? " 🏆" : " 🏁");
          kind = "big";
          if (s === me) say = "You finished " + ordinal(pl) + "!";
          break;
        }
        case "retired": text = N(s) + " stopped — tokens off the board"; kind = "muted"; break;
        case "play_continues": {
          const who = (Array.isArray(ev.seats) ? ev.seats : []).map((x) => seatName(x, st));
          text = "Play continues" + (who.length ? " for " + who.join(", ") : "") + " ▶";
          kind = "system";
          break;
        }
        case "game_over":
          text = ev.winner == null ? "Game over" : (ev.winner === me ? "You won the match! 🏆" : seatName(ev.winner, st) + " won the match 🏆");
          kind = "big"; say = text;
          break;
        default: break;
      }
      if (text) logLine(ev.type === "game_over" ? ev.winner : (ev.type === "shield_blocked" ? ev.victim_seat : ev.type === "play_continues" ? null : s), text, kind);
      if (say) announce(say);
    }
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  async function finishMatch(force) {
    const m = app.ended;
    if (!m || app.resultsShown) return;
    if (!force && (anim.running || anim.queue.length)) return;
    app.resultsShown = true;
    clearResume();
    cancelTargeting(true);
    const me = app.match ? app.match.you_seat : null;
    const results = Array.isArray(m.results) ? m.results : [];
    const mine = results.find((r) => r.seat === me);
    const won = mine ? mine.placement === 1 : (m.placements && m.placements[0] === me);
    if (m.state) {
      // Make sure the board shows the very final position (e.g. a resign race).
      const stale = !app.shownState || app.shownState.status === "playing";
      if (renderer && stale) { try { renderer.setState(m.state); } catch (_) { /* ignore */ } }
      app.shownState = m.state;
    }
    app.you = { seat: me, legal_actions: [] };
    updateGameUI();
    if (!RENDERER_HANDLES_SFX) {
      if (renderer && won) { try { renderer.celebrate(me); } catch (_) { /* ignore */ } }
      Sfx.play(won ? "win" : "lose");
    }
    // Refresh stats so the XP bar shows the new totals.
    const statsP = app.auth ? loadMyStats() : Promise.resolve(null);
    await new Promise((r) => setTimeout(r, won ? 1900 : 1100));
    if (app.ended !== m) return;
    renderResults(m, null);
    statsP.then(() => { if (app.ended === m) { renderXp(m); renderAccount(); } });
  }

  function renderResults(m) {
    const me = app.match ? app.match.you_seat : null;
    const st = m.state || app.shownState || {};
    const results = (Array.isArray(m.results) && m.results.length ? m.results : (m.placements || []).map((seat, i) => ({ seat, placement: i + 1, name: seatName(seat, st, false), kind: (seatInfo(seat, st) || {}).kind })))
      .slice().sort((a, b) => num(a.placement, 9) - num(b.placement, 9));
    const mine = results.find((r) => r.seat === me);
    const place = mine ? num(mine.placement, 0) : 0;
    const iResigned = !!(((st.players || [])[me] || {}).resigned);
    const iRetired = !!(((st.players || [])[me] || {}).retired);
    const card = dom.resultsCard;
    card.innerHTML = "";
    card.className = "modal-card results-card" + (place === 1 ? " is-win" : "");
    const medals = ["🥇", "🥈", "🥉", "4️⃣"];
    card.appendChild(h("div", { class: "results-top" },
      h("span", { class: "results-medal", "aria-hidden": "true", text: place ? medals[place - 1] || "🎲" : "🎲" }),
      h("p", { class: "eyebrow", text: (st.mode === "classic" ? "Classic" : "Power") + " match · " + results.length + " players" }),
      h("h2", { class: "results-title", id: "resultsTitle", text: place === 1 ? "You won!" : place ? "You finished " + ordinal(place) : "Match over" }),
      h("p", { class: "results-sub", text: place === 1 ? (iResigned ? "Everyone else left the table." : "All four tokens home. Nicely played.") : iResigned ? "You resigned this one." : iRetired ? "You stopped after " + (results[0] ? seatName(results[0].seat, st, false) : "the winner") + " finished." : place ? (results[0] ? seatName(results[0].seat, st, false) + " took the crown this time." : "") : "" })));

    const list = h("ol", { class: "placements" });
    results.forEach((r) => {
      const s = r.stats || ((st.players || [])[r.seat] || {}).stats || {};
      const isMe = r.seat === me;
      const kindTag = r.kind === "bot" ? "Bot" : r.kind === "guest" ? "Guest" : null;
      const resigned = !!(((st.players || [])[r.seat] || {}).resigned);
      const retired = !!(((st.players || [])[r.seat] || {}).retired);
      list.appendChild(h("li", { class: "placement seat-" + SEAT_COLOR[r.seat] + (isMe ? " mine" : "") },
        h("span", { class: "pl-rank", text: medals[num(r.placement, 4) - 1] || String(r.placement) }),
        h("span", { class: "pl-dot", "aria-hidden": "true" }),
        h("span", { class: "pl-who" },
          h("span", { class: "pl-name" }, r.name || seatName(r.seat, st, false), isMe ? h("span", { class: "tag tag-you", text: "You" }) : null, kindTag ? h("span", { class: "tag", text: kindTag }) : null, resigned ? h("span", { class: "tag tag-resigned", text: "Resigned" }) : null, retired ? h("span", { class: "tag tag-resigned", text: "Retired" }) : null),
          h("span", { class: "pl-stats" },
            chip("🏠", num(s.tokens_finished, 0) + "/4", "Tokens home"),
            chip("🗡️", num(s.captures, 0), "Captures"),
            chip("🎲", num(s.sixes, 0), "Sixes rolled"),
            st.mode !== "classic" ? chip("⚡", num(s.powerups_used, 0), "Power-ups used") : null)),
        r.xp_gained != null && r.kind !== "bot" && r.kind !== "guest" ? h("span", { class: "pl-xp", text: "+" + r.xp_gained + " XP" }) : null));
    });
    card.appendChild(list);

    card.appendChild(h("div", { class: "results-progress", id: "resultsProgress" }));
    card.appendChild(h("div", { class: "results-actions", id: "resultsActions" }));
    dom.resultsModal.classList.remove("hidden");
    renderXp(m);
    renderResultsActions();
    const first = card.querySelector(".results-actions .btn-primary");
    if (first) setTimeout(() => first.focus(), 30);
    announce(place === 1 ? "You won the match!" : place ? "You finished " + ordinal(place) + "." : "Match over.");
  }
  function chip(icon, value, label) {
    return h("span", { class: "pl-chip", title: label }, h("span", { "aria-hidden": "true", text: icon }), h("span", { class: "sr-only", text: label + ": " }), String(value));
  }

  function renderXp(m) {
    const box = document.getElementById("resultsProgress");
    if (!box) return;
    box.innerHTML = "";
    const me = app.match ? app.match.you_seat : null;
    const mine = (m.results || []).find((r) => r.seat === me);
    const recorded = mine && mine.kind !== "guest" && mine.kind !== "bot" && mine.xp_gained != null;
    if (!app.auth || !recorded) {
      box.appendChild(h("div", { class: "guest-cta" },
        h("span", { "aria-hidden": "true", text: "⭐" }),
        h("div", null,
          h("strong", { text: "This match wasn’t saved." }),
          h("p", { text: "Sign in to earn XP, climb the rating ladder and unlock achievements." })),
        h("a", { class: "btn btn-primary btn-sm", href: SIGN_IN_URL }, "Sign in")));
      return;
    }
    const s = app.myStats && app.myStats.stats;
    const gained = num(mine.xp_gained, 0);
    const after = levelInfo(s ? s.xp : gained, s);
    const before = levelInfo(Math.max(0, after.xp - gained));
    const levelUp = after.level > before.level;
    const xpRow = h("div", { class: "xp-row" },
      h("div", { class: "xp-row-head" },
        h("span", { class: "level-badge" }, h("small", { text: "LV" }), String(after.level)),
        h("span", { class: "xp-gain", text: "+" + gained + " XP" }),
        levelUp ? h("span", { class: "levelup", text: "Level up!" }) : null,
        h("span", { class: "xp-of", text: s ? fmtInt(after.into) + " / " + fmtInt(after.span) : "" })),
      h("div", { class: "xp-bar big", role: "progressbar", "aria-label": "Level progress", "aria-valuemin": "0", "aria-valuemax": String(after.span), "aria-valuenow": String(after.into) },
        h("span", { class: "xp-fill", style: { width: Math.round((levelUp ? 0 : before.pct) * 100) + "%" } })));
    box.appendChild(xpRow);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const fill = xpRow.querySelector(".xp-fill");
      if (fill) fill.style.width = Math.round(after.pct * 100) + "%";
    }));

    const rb = mine.rating_before, ra = mine.rating_after;
    if (rb != null && ra != null && rb !== ra) {
      const d = ra - rb;
      box.appendChild(h("div", { class: "rating-row" },
        h("span", { class: "rating-label", text: "Rating" }),
        h("span", { class: "rating-val", text: fmtInt(rb) + " → " + fmtInt(ra) }),
        h("span", { class: "rating-delta " + (d >= 0 ? "up" : "down"), text: (d >= 0 ? "▲ +" : "▼ ") + d })));
    } else {
      box.appendChild(h("div", { class: "rating-row muted" },
        h("span", { class: "rating-label", text: "Rating" }),
        h("span", { class: "rating-val", text: ra != null ? fmtInt(ra) : "—" }),
        h("span", { class: "rating-note", text: "Unrated — needs 2+ signed-in players" })));
    }

    const ach = Array.isArray(mine.new_achievements) ? mine.new_achievements : [];
    if (ach.length) {
      box.appendChild(h("p", { class: "field-label", text: "Achievements unlocked" }));
      box.appendChild(h("div", { class: "ach-new" }, ach.map((a) => h("span", { class: "ach-chip r-" + (a.rarity || "common"), title: a.description || "" },
        h("span", { class: "ach-chip-icon", "aria-hidden": "true", text: a.icon || "🏅" }), a.name || a.id, a.rarity ? h("span", { class: "rarity", text: a.rarity }) : null))));
    }
  }

  function againKind() {
    const i = app.intent;
    if (i && (i.kind === "create" || i.kind === "join")) return "room";
    if (i && i.kind === "quick") return "quick";
    if (i && i.kind === "bots") return "bots";
    return null; // e.g. rejoined after a reload: the server still knows where we came from
  }
  function renderResultsActions() {
    const box = document.getElementById("resultsActions");
    if (!box) return;
    box.innerHTML = "";
    const i = app.intent;
    const k = againKind();
    let again = "Play again";
    if (k === "room") again = "Play again · same room";
    else if (k === "bots" && i && i.bots) again = "Play again vs " + i.bots + (i.bots === 1 ? " bot" : " bots");
    else if (k === "quick") again = "Play again · quick match";
    const btn = h("button", { type: "button", class: "btn btn-primary" + (app.again ? " loading" : ""), onclick: playAgain, disabled: !!app.again }, again);
    box.appendChild(btn);
    box.appendChild(h("button", { type: "button", class: "btn btn-ghost", onclick: backToMenu }, "Back to menu"));
    if (app.auth) box.appendChild(h("button", { type: "button", class: "btn btn-ghost", onclick: () => { backToMenu(); setTab("stats"); } }, "My stats"));
  }

  function hideResults() { dom.resultsModal.classList.add("hidden"); }

  // Play again: the server keeps the room (private → same lobby; bots → same settings;
  // quick match → re-queue). Falls back to starting over if the old match is gone.
  function playAgain() {
    if (app.again) return;
    app.again = { at: Date.now(), kind: againKind(), code: app.room && app.room.code, intent: app.intent, mode: (app.match && app.match.mode) || app.mode };
    renderResultsActions();
    send({ type: "play_again" });
    clearTimeout(app.againTimer);
    app.againTimer = setTimeout(() => { if (app.again) againFallback("timeout"); }, 8000);
  }
  function clearAgain() {
    clearTimeout(app.againTimer);
    if (!app.again) return;
    app.again = null;
    renderResultsActions();
  }
  function againFallback(code, msg) {
    const a = app.again;
    clearAgain();
    if (!a) return;
    if (a.kind === "room" && (code === "room_in_progress" || code === "room_full")) {
      toast(msg || "That room has moved on.", "info", 4000);
      backToMenu();
      return;
    }
    const i = a.intent || {};
    if (!a.kind) { toast(msg || "That match has closed — start a new one from the menu.", "info", 4000); backToMenu(); return; }
    leaveMatchUI();
    if (a.kind === "room") {
      if (a.code) startIntent({ kind: "join", code: a.code });
      else startIntent({ kind: "create", mode: a.mode });
    } else if (a.kind === "quick") startIntent({ kind: "quick", mode: i.mode || a.mode });
    else startIntent({ kind: "bots", mode: i.mode || a.mode, bots: i.bots || app.bots });
  }
  function backToMenu() {
    if (app.match && app.ended) send({ type: "leave" });
    else if (app.roomAfterMatch && app.room) send({ type: "leave" });
    app.room = null;
    app.roomAfterMatch = false;
    leaveMatchUI();
  }

  // ---------------------------------------------------------------------------
  // Stats tab
  // ---------------------------------------------------------------------------
  async function loadStatsScreen() {
    const body = dom.statsBody;
    if (app.auth === null) { body.innerHTML = ""; body.appendChild(h("div", { class: "glass empty-card", text: "Loading…" })); await loadAccount(); }
    if (!app.auth) { renderStatsGuest(); return; }
    if (!app.myStats) { body.innerHTML = ""; body.appendChild(skeleton()); }
    await loadMyStats();
    if (app.screen !== "stats") return;
    if (!app.myStats) { body.innerHTML = ""; body.appendChild(h("div", { class: "glass empty-card" }, h("p", { text: "Couldn’t load your stats right now." }), h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: loadStatsScreen }, "Try again"))); return; }
    renderStats(app.myStats);
  }
  function skeleton() {
    return h("div", { class: "skeleton-grid", "aria-hidden": "true" }, [0, 1, 2, 3, 4, 5].map(() => h("div", { class: "skel" })));
  }
  function renderStatsGuest() {
    const body = dom.statsBody;
    body.innerHTML = "";
    body.appendChild(h("div", { class: "glass empty-card signin-card" },
      h("span", { class: "empty-icon", "aria-hidden": "true", text: "📊" }),
      h("h2", { class: "section-h", text: "Track your Ludo career" }),
      h("p", { text: "Sign in to save every match: wins, captures, rating, XP levels, achievements and your match history." }),
      h("a", { class: "btn btn-primary", href: SIGN_IN_URL }, "Sign in to save stats")));
  }

  function renderStats(data) {
    const body = dom.statsBody;
    body.innerHTML = "";
    const s = data.stats || {};
    const u = data.user || {};
    const display = u.display_name || u.username || (app.auth && app.auth.username) || "You";
    const lv = levelInfo(s.xp, s);
    const level = lv.level;

    // Header
    body.appendChild(h("div", { class: "stats-hero glass" },
      avatarEl(display, u.avatar_url, "avatar-xl"),
      h("div", { class: "stats-hero-id" },
        h("p", { class: "eyebrow", text: "Ludo career" }),
        h("h2", { class: "section-h", text: display }),
        h("div", { class: "stats-hero-level" },
          h("span", { class: "level-badge" }, h("small", { text: "LV" }), String(level)),
          h("div", { class: "xp-bar", role: "progressbar", "aria-label": "Level progress", "aria-valuemin": "0", "aria-valuemax": String(lv.span), "aria-valuenow": String(lv.into) },
            h("span", { class: "xp-fill", style: { width: Math.round(lv.pct * 100) + "%" } })),
          h("span", { class: "xp-of", text: fmtInt(lv.into) + " / " + fmtInt(lv.span) + " XP" }))),
      h("div", { class: "stats-hero-rating" },
        h("span", { class: "big-num", text: fmtInt(s.rating != null ? s.rating : 1000) }),
        h("span", { class: "stat-mini-label", text: (s.rated_games ? fmtInt(s.rated_games) + " rated games" : "Rating") }))));

    // Tiles
    const games = num(s.games_played, 0), wins = num(s.wins, 0);
    const tiles = [
      ["Games", fmtInt(games), "🎮"], ["Wins", fmtInt(wins), "👑"], ["Win rate", pct(s.win_rate, games, wins), "📈"],
      ["Streak · best " + fmtInt(s.best_streak), fmtInt(s.current_streak), "🔥"], ["Captures", fmtInt(s.captures), "🗡️"],
      ["Captured", fmtInt(s.times_captured), "💀"], ["Tokens home", fmtInt(s.tokens_finished), "🏠"], ["Sixes", fmtInt(s.sixes_rolled), "🎲"],
      ["Power-ups used", fmtInt(s.powerups_used), "⚡"],
    ];
    body.appendChild(h("div", { class: "tiles" }, tiles.map(([label, value, icon]) =>
      h("div", { class: "tile glass" }, h("span", { class: "tile-icon", "aria-hidden": "true", text: icon }), h("span", { class: "tile-value", text: value }), h("span", { class: "tile-label", text: label })))));

    const cols = h("div", { class: "stats-cols" });
    // Placements
    const pl = s.placements || {};
    const maxP = Math.max(1, ...[1, 2, 3, 4].map((k) => num(pl[k] != null ? pl[k] : pl[String(k)], 0)));
    cols.appendChild(h("div", { class: "glass panel" },
      h("p", { class: "field-label", text: "Finishes" }),
      h("div", { class: "place-bars" }, [1, 2, 3, 4].map((k) => {
        const v = num(pl[k] != null ? pl[k] : pl[String(k)], 0);
        return h("div", { class: "place-bar p" + k },
          h("span", { class: "place-label", text: ordinal(k) }),
          h("span", { class: "place-track" }, h("span", { class: "place-fill", style: { width: Math.round((v / maxP) * 100) + "%" } })),
          h("span", { class: "place-val", text: fmtInt(v) }));
      }))));

    // Recent matches
    const recent = Array.isArray(data.recent) ? data.recent : [];
    const recentPanel = h("div", { class: "glass panel" }, h("p", { class: "field-label", text: "Recent matches" }));
    if (!recent.length) recentPanel.appendChild(h("p", { class: "hint", text: "No matches yet — your games will show up here." }));
    else recentPanel.appendChild(h("ol", { class: "recent-list" }, recent.slice(0, 10).map((r) => {
      const p = num(r.placement, 0);
      const players = Array.isArray(r.players) ? r.players.length : num(r.players, 0);
      const myU = u.username || (app.auth && app.auth.username);
      const others = Array.isArray(r.players) ? r.players.filter((x) => x && x.username !== myU).map((x) => x.name).filter(Boolean) : [];
      const d = r.rating_delta;
      return h("li", { class: "recent-item" + (p === 1 ? " win" : "") },
        h("span", { class: "recent-place", text: p ? ordinal(p) : "–" }),
        h("span", { class: "recent-mid" },
          h("span", { class: "recent-title", text: (p === 1 ? "Win" : "Finished " + ordinal(p)) + (players ? " · " + players + " players" : "") }),
          h("span", { class: "recent-sub", text: (r.mode === "classic" ? "Classic" : "Power") + " · " + relTime(r.ended_at) + (others.length ? " · vs " + others.join(", ") : "") })),
        h("span", { class: "recent-right" },
          r.xp_gained != null ? h("span", { class: "recent-xp", text: "+" + r.xp_gained + " XP" }) : null,
          d ? h("span", { class: "rating-delta " + (d > 0 ? "up" : "down"), text: (d > 0 ? "+" : "") + d }) : null));
    })));
    cols.appendChild(recentPanel);
    body.appendChild(cols);

    // Achievements — kept in the server's (category) order.
    const ach = Array.isArray(data.achievements) ? data.achievements : [];
    const earned = ach.filter((a) => a.earned).length;
    const ratio = (a) => (a.progress && num(a.progress.target, 0) > 0 ? num(a.progress.current, 0) / num(a.progress.target, 1) : -1);
    const compact = !app.achExpanded && window.matchMedia && window.matchMedia("(max-width: 640px)").matches && ach.length > 10;
    let shown = ach;
    if (compact) {
      // Phones: everything earned + the 6 locked ones closest to unlocking.
      const near = new Set(ach.filter((a) => !a.earned).slice().sort((a, b) => ratio(b) - ratio(a)).slice(0, 6));
      shown = ach.filter((a) => a.earned || near.has(a));
    }
    const panel = h("div", { class: "glass panel" },
      h("div", { class: "card-head" }, h("p", { class: "field-label", text: "Achievements" }), h("span", { class: "ach-count", text: earned + " / " + ach.length })));
    if (!ach.length) panel.appendChild(h("p", { class: "hint", text: "No achievements available yet." }));
    else {
      // Group under category headings, in the order the server returns them.
      const CAT = { wins: "Wins", played: "Games played", combat: "Combat", skill: "Skill", power: "Power-ups", social: "Social" };
      const groups = [];
      shown.forEach((a) => {
        const c = a.category || "other";
        let g = groups.find((x) => x.c === c);
        if (!g) { g = { c, items: [] }; groups.push(g); }
        g.items.push(a);
      });
      groups.forEach((g) => {
        const all = ach.filter((a) => (a.category || "other") === g.c);
        if (groups.length > 1 || g.c !== "other") panel.appendChild(h("p", { class: "ach-cat" }, CAT[g.c] || (g.c.charAt(0).toUpperCase() + g.c.slice(1)), h("span", { text: all.filter((a) => a.earned).length + " / " + all.length })));
        panel.appendChild(achList(g.items));
      });
    }
    function achList(items) { return h("ul", { class: "ach-grid" }, items.map((a) => {
      const pr = !a.earned && a.progress && num(a.progress.target, 0) > 0 ? a.progress : null;
      const cur = pr ? Math.min(num(pr.current, 0), num(pr.target, 1)) : 0;
      return h("li", { class: "ach" + (a.earned ? " earned" : " locked") + " r-" + (a.rarity || "common") },
        h("span", { class: "ach-icon", "aria-hidden": "true", text: a.earned ? (a.icon || "🏅") : (a.icon || "🔒") }),
        h("span", { class: "ach-body" },
          h("span", { class: "ach-name" }, a.name || a.id, h("span", { class: "rarity", text: a.rarity || "common" })),
          h("span", { class: "ach-desc", text: a.description || "" }),
          pr ? h("span", { class: "ach-prog" },
            h("span", { class: "ach-prog-bar", role: "progressbar", "aria-label": (a.name || a.id) + " progress", "aria-valuemin": "0", "aria-valuemax": String(pr.target), "aria-valuenow": String(cur) },
              h("span", { class: "ach-prog-fill", style: { width: Math.round((cur / num(pr.target, 1)) * 100) + "%" } })),
            h("span", { class: "ach-prog-txt", text: fmtInt(cur) + " / " + fmtInt(pr.target) })) : null,
          a.earned && a.unlocked_at ? h("span", { class: "ach-when", text: "Unlocked " + relTime(a.unlocked_at) }) : null));
    })); }
    if (compact || app.achExpanded) {
      panel.appendChild(h("button", { type: "button", class: "btn btn-ghost btn-sm ach-toggle", "aria-expanded": app.achExpanded ? "true" : "false",
        onclick: () => { app.achExpanded = !app.achExpanded; renderStats(data); } }, app.achExpanded ? "Show fewer" : "Show all " + ach.length));
    }
    body.appendChild(panel);
  }

  // ---------------------------------------------------------------------------
  // Leaderboard tab
  // ---------------------------------------------------------------------------
  const lbGroup = radioGroup(dom.lbSort, "sort", (sort) => { app.lbSort = sort; loadLeaderboard(); });
  let lbReq = 0;
  async function loadLeaderboard() {
    const req = ++lbReq;
    lbGroup.set(app.lbSort);
    dom.lbBody.innerHTML = "";
    dom.lbBody.appendChild(skeleton());
    let r;
    try { r = await getJSON("/api/ludo/leaderboard?sort=" + encodeURIComponent(app.lbSort) + "&limit=20"); } catch (_) { r = { ok: false }; }
    if (req !== lbReq) return;
    dom.lbBody.innerHTML = "";
    if (!r.ok || !r.body) {
      dom.lbBody.appendChild(h("div", { class: "empty-card" }, h("p", { text: "Couldn’t load the leaderboard." }), h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: loadLeaderboard }, "Try again")));
      return;
    }
    const rows = Array.isArray(r.body.entries) ? r.body.entries : [];
    if (!rows.length) {
      dom.lbBody.appendChild(h("div", { class: "empty-card" }, h("span", { class: "empty-icon", "aria-hidden": "true", text: "🏆" }), h("p", { text: "No ranked players yet — win a signed-in match to claim the top spot." })));
      return;
    }
    const myName = app.auth ? app.auth.username : null;
    const sortCol = app.lbSort;
    const table = h("table", { class: "lb-table" },
      h("caption", { class: "sr-only", text: "Ludo leaderboard sorted by " + (sortCol === "xp" ? "level" : sortCol) }),
      h("thead", null, h("tr", null,
        h("th", { scope: "col", class: "c-rank", text: "#" }),
        h("th", { scope: "col", text: "Player" }),
        h("th", { scope: "col", class: "c-num" + (sortCol === "wins" ? " sorted" : ""), text: "Wins" }),
        h("th", { scope: "col", class: "c-num c-hide-sm", text: "Played" }),
        h("th", { scope: "col", class: "c-num c-hide-sm", text: "Win %" }),
        h("th", { scope: "col", class: "c-num" + (sortCol === "rating" ? " sorted" : ""), text: "Rating" }),
        h("th", { scope: "col", class: "c-num" + (sortCol === "xp" ? " sorted" : ""), text: "Lv" }))),
      h("tbody", null, rows.map((e, idx) => {
        const rank = e.rank || idx + 1;
        const name = e.display_name || e.username || "Player";
        const me = myName && e.username === myName;
        return h("tr", { class: (me ? "me " : "") + (rank <= 3 ? "top top" + rank : "") },
          h("td", { class: "c-rank" }, h("span", { class: "rank-badge", text: rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : String(rank) })),
          h("td", { class: "c-player" }, h("a", { href: "/u/" + encodeURIComponent(e.username || ""), class: "lb-player" },
            avatarEl(name, e.avatar_url, "avatar-sm"), h("span", { class: "lb-name", text: name }), me ? h("span", { class: "tag tag-you", text: "You" }) : null)),
          h("td", { class: "c-num", text: fmtInt(e.wins) }),
          h("td", { class: "c-num c-hide-sm", text: fmtInt(e.games_played) }),
          h("td", { class: "c-num c-hide-sm", text: pct(e.win_rate, e.games_played, e.wins) }),
          h("td", { class: "c-num", text: fmtInt(e.rating) }),
          h("td", { class: "c-num", text: String(e.level != null ? e.level : "–") }));
      })));
    dom.lbBody.appendChild(h("div", { class: "table-scroll" }, table));
  }

  // ---------------------------------------------------------------------------
  // Chat (lobby + match). Every string from the server is rendered with
  // textContent (via h(..., {text})) — never innerHTML. The server does not escape.
  // ---------------------------------------------------------------------------
  function mySeatNow() {
    if (app.screen === "game" && app.match) return app.match.you_seat;
    if (app.room && app.room.you_seat != null) return app.room.you_seat;
    return app.match ? app.match.you_seat : null;
  }
  function placeChat(screen) {
    const slot = screen === "lobby" ? dom.lobbyChatSlot : screen === "game" ? dom.gameChatSlot : null;
    if (!slot) return;
    if (dom.chatPanel.parentNode !== slot) slot.appendChild(dom.chatPanel);
    setChatOpen(screen === "lobby" ? true : app.chatOpenGame);
  }
  function chatIsOpen() { return dom.chatPanel.dataset.open === "true"; }
  function setChatOpen(open, focus) {
    dom.chatPanel.dataset.open = open ? "true" : "false";
    dom.chatToggle.setAttribute("aria-expanded", open ? "true" : "false");
    dom.btnChat.setAttribute("aria-expanded", open ? "true" : "false");
    if (app.screen === "game") app.chatOpenGame = !!open;
    if (open) {
      app.chatUnread = 0;
      dom.chatList.scrollTop = dom.chatList.scrollHeight;
      if (focus) { try { dom.chatInput.focus({ preventScroll: true }); } catch (_) { dom.chatInput.focus(); } }
    }
    updateChatBadge();
  }
  function updateChatBadge() {
    const n = app.chatUnread;
    const txt = n > 9 ? "9+" : String(n);
    [dom.chatBadge, dom.chatToolBadge].forEach((b) => { b.textContent = txt; b.classList.toggle("hidden", n <= 0); });
    dom.btnChat.setAttribute("aria-label", n > 0 ? "Chat, " + n + " unread" : "Chat");
  }
  function validLine(l) { return l && typeof l === "object" && l.text != null && String(l.text).trim() !== ""; }
  function chatLineEl(l) {
    const seat = num(l.seat, -1);
    const mine = seat >= 0 && seat === mySeatNow();
    const when = l.ts ? new Date(num(l.ts, 0) < 1e12 ? num(l.ts, 0) * 1000 : num(l.ts, 0)) : null;
    return h("li", { class: "chat-line" + (SEAT_COLOR[seat] ? " seat-" + SEAT_COLOR[seat] : "") + (mine ? " mine" : ""), title: when && !isNaN(when) ? when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null },
      h("span", { class: "chat-dot", "aria-hidden": "true" }),
      h("span", { class: "chat-name", text: mine ? "You" : String(l.name || SEAT_LABEL[seat] || "Player").slice(0, 24) }),
      h("span", { class: "chat-text", text: String(l.text).slice(0, CHAT_MAX) }));
  }
  function renderChat() {
    const near = dom.chatList.scrollHeight - dom.chatList.scrollTop - dom.chatList.clientHeight < 40;
    dom.chatList.textContent = "";
    const lines = app.chat.filter((l) => !isMutedSeat(num(l.seat, -1)));
    lines.forEach((l) => dom.chatList.appendChild(chatLineEl(l)));
    dom.chatEmpty.classList.toggle("hidden", lines.length > 0);
    if (near || !lines.length) dom.chatList.scrollTop = dom.chatList.scrollHeight;
  }
  function setChatHistory(list) {
    const lines = list.filter(validLine).slice(-CHAT_KEEP);
    const lastTs = app.chat.length ? num(app.chat[app.chat.length - 1].ts, 0) : 0;
    const me = mySeatNow();
    const fresh = app.chat.length ? lines.filter((l) => num(l.ts, 0) > lastTs && num(l.seat, -1) !== me && !isMutedSeat(num(l.seat, -1))).length : 0;
    app.chat = lines;
    if (fresh && !chatIsOpen()) { app.chatUnread += fresh; updateChatBadge(); }
    renderChat();
  }
  function clearChat() {
    app.chat = [];
    app.chatUnread = 0;
    updateChatBadge();
    renderChat();
  }
  function onChat(m) {
    if (!validLine(m)) return;
    const seat = num(m.seat, -1);
    if (isMutedSeat(seat)) return;
    const line = { seat, name: m.name, text: String(m.text), ts: m.ts };
    app.chat.push(line);
    if (app.chat.length > CHAT_KEEP) app.chat.splice(0, app.chat.length - CHAT_KEEP);
    const near = dom.chatList.scrollHeight - dom.chatList.scrollTop - dom.chatList.clientHeight < 40;
    dom.chatList.appendChild(chatLineEl(line));
    while (dom.chatList.children.length > CHAT_KEEP) dom.chatList.firstChild.remove();
    dom.chatEmpty.classList.add("hidden");
    if (near) dom.chatList.scrollTop = dom.chatList.scrollHeight;
    const mine = seat === mySeatNow();
    if (!mine && (!chatIsOpen() || document.hidden)) { app.chatUnread += 1; updateChatBadge(); }
    if (!mine) Sfx.play("chat");
    if (renderer && app.screen === "game" && typeof renderer.showChat === "function") { try { renderer.showChat(seat, line.text); } catch (_) { /* ignore */ } }
  }
  dom.chatToggle.addEventListener("click", () => setChatOpen(!chatIsOpen(), !chatIsOpen()));
  dom.btnChat.addEventListener("click", () => {
    setChatOpen(true, true);
    try { dom.chatPanel.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" }); } catch (_) { /* ignore */ }
  });
  dom.chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = dom.chatInput.value.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
    if (!text) return;
    if (!(app.screen === "lobby" || app.screen === "game")) return;
    const now = Date.now();
    if (now < app.chatReadyAt) { toast("One message every 1.5 seconds.", "info", 1600); return; }
    app.chatReadyAt = now + CHAT_GAP_MS;
    send({ type: "chat", text });
    dom.chatInput.value = "";
  });

  // ---------------------------------------------------------------------------
  // Local mutes (chat + throws), per match / per room, kept for the session.
  // ---------------------------------------------------------------------------
  function muteScope() {
    if (app.match && app.match.match_id) return "m:" + app.match.match_id;
    if (app.room && app.room.code) return "r:" + app.room.code;
    return null;
  }
  function anySeatInfo(seat) {
    if (app.screen === "lobby" && app.room) return (app.room.seats || [])[seat] || null;
    return seatInfo(seat, app.shownState || app.startState) || (app.room ? (app.room.seats || [])[seat] || null : null);
  }
  function idOfSeat(seat) {
    const info = anySeatInfo(seat);
    if (!info) return null;
    return info.username ? "u:" + info.username : "n:" + (info.name || "") + "#" + seat;
  }
  function muteStore() { const v = ssGet(SS_MUTES); return v && typeof v === "object" ? v : {}; }
  function mutedIds() { const sc = muteScope(); return new Set(sc ? (muteStore()[sc] || []) : []); }
  function isMutedSeat(seat) {
    if (seat == null || seat < 0 || seat === mySeatNow()) return false;
    const id = idOfSeat(seat);
    return !!id && mutedIds().has(id);
  }
  function setSeatMuted(seat, on) {
    const sc = muteScope(), id = idOfSeat(seat);
    if (!sc || !id) return;
    const store = muteStore();
    const set = new Set(store[sc] || []);
    if (on) set.add(id); else set.delete(id);
    store[sc] = Array.from(set);
    const keys = Object.keys(store);
    if (keys.length > 8) keys.slice(0, keys.length - 8).forEach((k) => { if (k !== sc) delete store[k]; });
    ssSet(SS_MUTES, store);
    renderChat();
    syncMutedPods();
    const name = (anySeatInfo(seat) || {}).name || SEAT_LABEL[seat];
    announce(on ? name + " muted. You won’t see their chat or throws." : name + " unmuted.");
  }
  function carryMutes(from, to) {
    if (!from || !to || from === to) return;
    const store = muteStore();
    if (!store[from] || !store[from].length || (store[to] && store[to].length)) return;
    store[to] = store[from].slice();
    ssSet(SS_MUTES, store);
  }
  function syncMutedPods() {
    if (!renderer || typeof renderer.setMutedSeats !== "function") return;
    try { renderer.setMutedSeats([0, 1, 2, 3].filter((x) => isMutedSeat(x))); } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Throwables
  // ---------------------------------------------------------------------------
  function onThrow(m) {
    const from = num(m.from_seat, -1), to = num(m.target_seat, -1);
    if (from < 0 || to < 0 || !THROW_META[m.item]) return;
    if (isMutedSeat(from)) return;
    if (!renderer || app.screen !== "game" || typeof renderer.throwItem !== "function") return;
    try { renderer.throwItem(from, to, m.item); } catch (err) { console.warn("[ludo] throw failed", err); }
    const me = mySeatNow();
    if (to === me && from !== me) announce(seatName(from, null, false) + " threw " + THROW_META[m.item].a + " at you!");
  }
  function sendThrow(target, item) {
    const now = Date.now();
    if (now < app.throwReadyAt) { toast("One throw every 3 seconds.", "info", 1600); return; }
    app.throwReadyAt = now + THROW_GAP_MS;
    send({ type: "throw", target_seat: target, item });
    closePodMenu(true);
  }

  // ---------------------------------------------------------------------------
  // Player menu (click an avatar / pod): profile, throws, local mute
  // ---------------------------------------------------------------------------
  let podMenu = null;
  function closePodMenu(refocus) {
    if (!podMenu) return;
    const pm = podMenu;
    podMenu = null;
    pm.el.remove();
    if (pm.backdrop) pm.backdrop.remove();
    clearInterval(pm.timer);
    document.removeEventListener("pointerdown", pm.outside, true);
    window.removeEventListener("resize", pm.onResize);
    app.podMenuClosed = { seat: pm.seat, at: Date.now() };
    if (refocus && pm.opener && pm.opener.isConnected) { try { pm.opener.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
  }
  function throwArt(id) {
    const R = window.LudoRenderer;
    const span = h("span", { class: "pm-art", "aria-hidden": "true" });
    // Static SVG constants shipped in render.js (no user data), so innerHTML is safe here.
    if (R && R.THROWABLES && R.THROWABLES[id]) span.innerHTML = R.THROWABLES[id].svg;
    else span.textContent = THROW_META[id].emoji;
    return span;
  }
  function openPodMenu(seat, rect, ctx, opener) {
    if (seat < 0) return;
    const recent = app.podMenuClosed;
    if (podMenu && podMenu.seat === seat) { closePodMenu(true); return; }
    if (recent && recent.seat === seat && Date.now() - recent.at < 250) return; // same click that closed it
    closePodMenu();
    const info = ctx === "lobby" ? ((app.room && app.room.seats) || [])[seat] : seatInfo(seat);
    if (!info) return;
    const me = ctx === "lobby" ? (app.room ? app.room.you_seat : null) : (app.match ? app.match.you_seat : null);
    const isMe = seat === me;
    const isBot = info.kind === "bot";
    const name = info.name || SEAT_LABEL[seat];
    const el = h("div", { class: "pod-menu seat-" + SEAT_COLOR[seat], role: "dialog", "aria-label": name + " — player menu" });
    const sub = isBot ? "Bot" : info.kind === "guest" ? "Guest" : info.username ? "@" + info.username : "Player";
    el.appendChild(h("div", { class: "pm-head" },
      avatarEl(name, info.avatar_url, "avatar-sm"),
      h("div", { class: "pm-id" }, h("span", { class: "pm-name", text: name }), h("span", { class: "pm-sub", text: isMe ? sub + " · you" : sub })),
      h("button", { type: "button", class: "pm-close", "aria-label": "Close menu", onclick: () => closePodMenu(true) }, "✕")));
    const items = h("div", { class: "pm-items" });
    if (info.username && !isBot && info.kind !== "guest") {
      items.appendChild(h("a", { class: "pm-item", href: "/u/" + encodeURIComponent(info.username), target: "_blank", rel: "noopener noreferrer" },
        h("span", { "aria-hidden": "true", text: "👤" }), h("span", { text: isMe ? "View my profile" : "View profile" }), h("span", { class: "pm-ext", "aria-hidden": "true", text: "↗" })));
    }
    const st = app.shownState;
    const canThrow = ctx === "game" && !isMe && app.match && st && (st.seats || [])[me];
    if (canThrow) {
      items.appendChild(h("p", { class: "pm-label", text: "Throw at " + name }));
      const grid = h("div", { class: "pm-throws", role: "group", "aria-label": "Throw something at " + name });
      THROW_ITEMS.forEach((id) => {
        grid.appendChild(h("button", { type: "button", class: "pm-throw", "data-item": id, title: THROW_META[id].name, "aria-label": "Throw " + THROW_META[id].a + " at " + name, onclick: () => sendThrow(seat, id) },
          throwArt(id), h("span", { class: "pm-throw-name", text: THROW_META[id].name })));
      });
      items.appendChild(grid);
      const cd = h("p", { class: "pm-cool hidden", "aria-live": "polite" });
      items.appendChild(cd);
      const tick = () => {
        const left = app.throwReadyAt - Date.now();
        grid.querySelectorAll("button").forEach((b) => { b.disabled = left > 0; });
        cd.classList.toggle("hidden", left <= 0);
        if (left > 0) cd.textContent = "Next throw in " + Math.ceil(left / 1000) + "s";
      };
      tick();
      var timer = setInterval(tick, 250);
    }
    if (!isMe && !isBot) {
      const muted = isMutedSeat(seat);
      items.appendChild(h("button", { type: "button", class: "pm-item pm-mute", "aria-pressed": muted ? "true" : "false", onclick: () => { setSeatMuted(seat, !muted); closePodMenu(true); } },
        h("span", { "aria-hidden": "true", text: muted ? "🔊" : "🔇" }), h("span", { text: muted ? "Unmute " + name : "Mute chat & throws" })));
    }
    if (isMe && !items.children.length) items.appendChild(h("p", { class: "pm-note", text: "That’s you! Tap another player to throw something or mute them." }));
    if (isBot && !canThrow) items.appendChild(h("p", { class: "pm-note", text: "A bot. It doesn’t chat." }));
    el.appendChild(items);

    const sheet = window.innerWidth <= 640;
    let backdrop = null;
    if (sheet) {
      el.classList.add("pm-sheet");
      backdrop = h("div", { class: "pm-backdrop", onclick: () => closePodMenu(true) });
      document.body.appendChild(backdrop);
    }
    document.body.appendChild(el);
    if (!sheet) {
      const r = rect || (opener && opener.getBoundingClientRect()) || { left: window.innerWidth / 2, right: window.innerWidth / 2, top: 100, bottom: 100, width: 0 };
      const w = el.offsetWidth, hgt = el.offsetHeight;
      const left = clamp(r.left + r.width / 2 - w / 2, 8, window.innerWidth - w - 8);
      let top = r.bottom + 8;
      if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 8);
      el.style.left = Math.round(left) + "px";
      el.style.top = Math.round(top) + "px";
    }
    const outside = (e) => { if (podMenu && !el.contains(e.target) && !(opener && opener.contains && opener.contains(e.target))) closePodMenu(); };
    const onResize = () => closePodMenu();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onResize);
    podMenu = { el, backdrop, seat, ctx, opener, outside, onResize, timer: typeof timer !== "undefined" ? timer : null };
    Sfx.play("click");
    const first = el.querySelector(".pm-items a, .pm-items button:not(:disabled)") || el.querySelector(".pm-close");
    if (first) setTimeout(() => { try { first.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }, 0);
  }
  window.addEventListener("scroll", () => { if (podMenu && !podMenu.backdrop) closePodMenu(); }, { passive: true });

  // ---------------------------------------------------------------------------
  // Continue after the first win (modal with countdown)
  // ---------------------------------------------------------------------------
  let continueTimer = null;
  function onContinuePrompt(m) {
    if (!app.match) return;
    const total = 20000;
    let remain = num(m.deadline_ms, 0) - Date.now();
    if (!(remain > 0 && remain < total + 5000)) remain = total; // clock skew: assume a fresh 20 s
    const winner = m.winner_seat;
    app.prompt = { deadline: Date.now() + remain, total: Math.max(remain, 1000), winner };
    closePodMenu();
    dom.continueTitle.textContent = winner == null ? "We have a winner!" : seatName(winner, null, false) + " finished 1st!";
    dom.continueText.textContent = "Keep playing for 2nd place and below?";
    dom.continueModal.classList.remove("hidden");
    Sfx.play("prompt");
    announce(dom.continueTitle.textContent + " Keep playing? You have " + Math.ceil(remain / 1000) + " seconds.");
    setTimeout(() => { try { dom.continueYes.focus(); } catch (_) { /* ignore */ } }, 30);
    clearInterval(continueTimer);
    const tick = () => {
      const p = app.prompt;
      if (!p) { clearInterval(continueTimer); return; }
      const left = Math.max(0, p.deadline - Date.now());
      dom.continueSecs.textContent = String(Math.ceil(left / 1000));
      dom.continueRing.style.strokeDashoffset = (100 * (1 - left / p.total)).toFixed(2);
      dom.continueModal.classList.toggle("urgent", left < 5000);
      if (left <= 0) { closeContinue(); }
    };
    tick();
    continueTimer = setInterval(tick, 200);
    if (app.screen === "game") updateGameUI({ board: false });
  }
  function closeContinue() {
    clearInterval(continueTimer);
    continueTimer = null;
    const was = !!app.prompt;
    app.prompt = null;
    if (!dom.continueModal.classList.contains("hidden")) dom.continueModal.classList.add("hidden");
    if (was && app.screen === "game" && app.shownState) updateGameUI({ board: false });
  }
  function answerContinue(yes) {
    if (!app.prompt) return;
    send({ type: "continue", yes: !!yes });
    Sfx.play("click");
    closeContinue();
  }
  dom.continueYes.addEventListener("click", () => answerContinue(true));
  dom.continueNo.addEventListener("click", () => answerContinue(false));
  function onContinueStatus(m) {
    const seat = num(m.seat, -1);
    if (seat < 0) return;
    const me = app.match ? app.match.you_seat : null;
    const yes = m.choice === true || m.choice === "yes";
    if (seat === me) {
      closeContinue();
      toast(yes ? "You’re playing on — good luck!" : "You stopped here. If nobody keeps playing, the match ends now.", yes ? "ok" : "info", 3600);
    }
    logLine(seat, (seat === me ? "You" : seatName(seat, null, false)) + (yes ? " will keep playing ▶" : " chose to stop"), "muted");
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!dom.confirmModal.classList.contains("hidden")) {
      if (e.key === "Escape") { e.preventDefault(); closeConfirm(false); }
      trapFocus(dom.confirmModal, e);
      return;
    }
    if (!dom.continueModal.classList.contains("hidden")) { trapFocus(dom.continueModal, e); return; }
    if (podMenu && e.key === "Escape") { e.preventDefault(); closePodMenu(true); return; }
    if (!dom.resultsModal.classList.contains("hidden")) { trapFocus(dom.resultsModal, e); return; }
    if (e.key === "Escape") {
      if (!dom.emotePop.classList.contains("hidden")) { closeEmotes(true); return; }
      if (app.targeting) { e.preventDefault(); cancelTargeting(); return; }
      return;
    }
    if (app.screen !== "game" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    const onControl = t && t.closest && t.closest("button, a, [role=button], [role=radio], [role=tab]");
    if ((e.key === " " || e.key === "Enter") && !onControl) {
      const L = legal();
      if (L.roll && canInteract() && !app.targeting) { e.preventDefault(); sendAction({ type: "roll" }); }
      else if (e.key === " ") e.preventDefault();
      return;
    }
    if (/^[1-4]$/.test(e.key) && !app.targeting) {
      const tok = Number(e.key) - 1;
      if (canInteract() && legal().moves.includes(tok)) { e.preventDefault(); sendAction({ type: "move", token: tok }); }
    }
  });

  // ---------------------------------------------------------------------------
  // Fallback renderer (only used if render.js failed to load)
  // ---------------------------------------------------------------------------
  class FallbackRenderer {
    constructor(el, opts) {
      this.el = el; this.handlers = {}; this.viewSeat = (opts && opts.viewSeat) || 0;
      this.state = null; this.sel = []; this.target = null; this.dice = {}; this.emotes = {};
      this.root = h("div", { class: "fb-board" });
      el.appendChild(this.root);
    }
    on(evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); }
    emit(evt, d) { (this.handlers[evt] || []).forEach((f) => f(d)); }
    setState(s) { this.state = s; this.draw(); }
    playEvents(evs, s) { return new Promise((r) => setTimeout(() => { this.setState(s); r(); }, 150)); }
    setViewSeat(s) { this.viewSeat = s; this.draw(); }
    setSelectable(t) { this.sel = t || []; this.draw(); }
    setTargeting(spec) { this.target = spec; this.draw(); }
    setDice(d) { this.dice = d || {}; this.draw(); }
    setTimer() { /* no-op */ }
    showEmote(seat, e) { this.emotes[seat] = e; this.draw(); setTimeout(() => { delete this.emotes[seat]; this.draw(); }, 2000); }
    flash() { /* no-op */ }
    celebrate() { /* no-op */ }
    resize() { /* no-op */ }
    destroy() { this.root.remove(); }
    draw() {
      const s = this.state; this.root.innerHTML = "";
      if (!s) return;
      this.root.appendChild(h("p", { class: "fb-note", text: "Simple board view (graphics unavailable)" }));
      (s.active_seats || [0, 1, 2, 3]).forEach((seat) => {
        const info = (s.seats || [])[seat] || {};
        const row = h("div", { class: "fb-row seat-" + SEAT_COLOR[seat] + (s.turn && s.turn.seat === seat ? " on" : "") },
          h("span", { class: "fb-name", text: (info.name || SEAT_LABEL[seat]) + (this.emotes[seat] ? " " + this.emotes[seat] : "") }));
        if (this.target && this.target.kind === "seat" && this.target.valid.includes(seat)) row.appendChild(h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => this.emit("seat", { seat }) }, "Target"));
        ((s.tokens || [])[seat] || []).forEach((p, t) => {
          const selectable = this.sel.some((x) => x.seat === seat && x.token === t)
            || (this.target && (this.target.kind === "own_token" || this.target.kind === "opponent_token") && this.target.valid.some((x) => x.seat === seat && x.token === t));
          row.appendChild(h("button", { type: "button", class: "fb-tok" + (selectable ? " sel" : ""), disabled: !selectable, onclick: () => this.emit("token", { seat, token: t }) }, p < 0 ? "yard" : p >= 56 ? "home" : String(p)));
        });
        this.root.appendChild(row);
      });
      const d = this.dice || {};
      this.root.appendChild(h("button", { type: "button", class: "btn btn-primary fb-dice", disabled: !d.enabled, onclick: () => this.emit("dice", {}) }, "🎲 " + ((d.values || []).join(" ") || "–")));
      if (this.target && this.target.kind === "square") {
        const row = h("div", { class: "fb-row" });
        this.target.valid.slice(0, 12).forEach((abs) => row.appendChild(h("button", { type: "button", class: "fb-tok sel", onclick: () => this.emit("square", { abs }) }, "□" + abs)));
        this.root.appendChild(row);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  const baseTitle = document.title;

  function boot() {
    renderPowerList();
    renderModeInfo();
    applyMute();
    renderAccount();
    loadAccount();

    const params = new URLSearchParams(location.search);
    const roomParam = normCode(params.get("room"));
    const resume = readResume();
    if (resume) {
      // Reload mid-match: reconnect and ask the server to restore our seat.
      showScreen("game");
      dom.turnTitle.textContent = "Rejoining your match…";
      dom.turnSub.textContent = "";
      app.match = { match_id: resume.match_id, you_seat: num(resume.you_seat, 0), seat_token: resume.seat_token, mode: "power" };
      if (roomParam) app.pendingRoom = roomParam;
      connect();
    } else if (roomParam && roomParam.length >= 4) {
      dom.joinCode.value = roomParam;
      startIntent({ kind: "join", code: roomParam });
    } else {
      const tab = location.hash.replace("#", "");
      if (TAB_SCREENS[tab] && tab !== "play") setTab(tab, true);
      else showScreen("home");
    }
  }

  // Read-only debugging hook (state is server-authoritative; nothing here can cheat).
  Object.defineProperty(window, "__ludo", {
    value: Object.freeze({
      get screen() { return app.screen; },
      get state() { return app.shownState; },
      get you() { return app.you; },
      get match() { return app.match; },
      get net() { return net.state; },
      get busy() { return anim.running || anim.queue.length > 0 || app.pending; },
      legal: () => legal(),
    }),
  });

  boot();
})();
