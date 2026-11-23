/*
  Shared helpers for arcade game pages.

  Primary API (finished games):
    CartofiaGame.reportResult({ slug?, result, score?, duration_seconds?, extra? })
      -> Promise<server JSON | null>
    POSTs to /api/arcade/games/<slug>/result. The server validates/clamps the
    result, updates per-game stats + leaderboards, unlocks achievements and
    logs the profile activity exactly once. `slug` defaults to the URL slug
    (/arcade/<slug>/). `extra.mode` = "online" marks a multiplayer-room game
    (the room server already logs that session to the profile).
    Guests get a silent 401 and nothing is recorded.
    After every report a `cartofia:game-result` event is dispatched on window
    with detail { request, response, status } (game-stats.js listens).

  Legacy API (kept for older callers):
    window.logGameActivity({ game, result?, score?, duration_seconds?, ... })
      -> routed to reportResult for stats-enabled games, otherwise posts the
         old `played_game` entry to /api/profile/me/activity.

  Session fallback (only for games WITHOUT result reporting, e.g. Cartofia):
    If a visitor interacts, stays 15s+, and leaves without any result being
    logged, one `played_game` entry is recorded on pagehide / hidden.
    Stats-enabled games skip it: only finished games count.

  window.__markGameStart() — reset the session start (Cartofia WASM splash).
*/
(function () {
  var startedAt   = Date.now();
  var interacted  = false;
  var alreadyLogged = false;
  var MIN_SESSION_SECONDS = 15;
  var STATS_GAMES = ["snake", "minesweeper", "bomber-raid", "word-puzzle", "maze-chase",
                     "blackjack", "zuma", "chess", "brick-blitz"];
  var SLUG_ALIASES = { "zuma-temple": "zuma" };

  function getToken() {
    try {
      return sessionStorage.getItem("oidc_access_token")
          || localStorage.getItem("oidc_access_token");
    } catch (_) { return null; }
  }

  // Auth: the httpOnly cartofia_session cookie (sent via credentials) is the
  // primary path since the Oct 2026 cookie migration. A legacy stored JWT is
  // still attached as a Bearer header when present. Guests get a silent 401.
  function authHeaders() {
    var headers = { "Content-Type": "application/json" };
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    return headers;
  }

  function post(payload, useKeepalive) {
    var init = {
      method: "POST",
      credentials: "include",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    };
    if (useKeepalive) init.keepalive = true;
    try { fetch("/api/profile/me/activity", init).catch(function () {}); }
    catch (_) {}
  }

  function deriveGameSlug() {
    var m = location.pathname.match(/\/arcade\/([^\/?#]+)/);
    return m ? m[1] : null;
  }

  function normSlug(s) {
    s = String(s || "").toLowerCase();
    return SLUG_ALIASES[s] || s;
  }

  function isStatsGame(slug) { return STATS_GAMES.indexOf(normSlug(slug)) >= 0; }

  function emit(detail) {
    try { window.dispatchEvent(new CustomEvent("cartofia:game-result", { detail: detail })); }
    catch (_) {}
  }

  function reportResult(data) {
    data = data || {};
    alreadyLogged = true;
    var slug = normSlug(data.slug || data.game || deriveGameSlug());
    var body = {
      result: data.result != null ? String(data.result) : "",
      duration_seconds: Math.max(0, Math.round(Number(data.duration_seconds) || 0)),
      extra: (data.extra && typeof data.extra === "object") ? data.extra : {}
    };
    if (data.score != null && isFinite(Number(data.score))) body.score = Math.round(Number(data.score));
    if (!slug || !isStatsGame(slug)) return Promise.resolve(null);
    var init = {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: authHeaders(),
      body: JSON.stringify(body)
    };
    var req = { slug: slug, result: body.result, score: body.score, duration_seconds: body.duration_seconds, extra: body.extra };
    try {
      return fetch("/api/arcade/games/" + encodeURIComponent(slug) + "/result", init)
        .then(function (r) {
          return r.json().catch(function () { return null; }).then(function (j) {
            emit({ request: req, response: j, status: r.status });
            return r.ok ? j : null;
          });
        })
        .catch(function () { emit({ request: req, response: null, status: 0 }); return null; });
    } catch (_) { return Promise.resolve(null); }
  }

  window.CartofiaGame = {
    reportResult: reportResult,
    slug: function () { return normSlug(deriveGameSlug()); },
    isStatsGame: isStatsGame
  };
  window.reportGameResult = reportResult;

  window.__markGameStart = function () { startedAt = Date.now(); };

  window.logGameActivity = async function (data) {
    data = data || {};
    if (isStatsGame(data.game || deriveGameSlug())) {
      var extra = {};
      Object.keys(data).forEach(function (k) {
        if (["game", "slug", "result", "score", "duration_seconds", "extra"].indexOf(k) < 0) extra[k] = data[k];
      });
      if (data.extra && typeof data.extra === "object") {
        Object.keys(data.extra).forEach(function (k) { extra[k] = data.extra[k]; });
      }
      return reportResult({ slug: data.game, result: data.result, score: data.score,
                            duration_seconds: data.duration_seconds, extra: extra });
    }
    alreadyLogged = true;
    post({ event_type: "played_game", metadata: data }, false);
  };

  function sessionFlush() {
    if (alreadyLogged || !interacted) return;
    var game = deriveGameSlug();
    if (!game || isStatsGame(game)) return;
    var secs = Math.round((Date.now() - startedAt) / 1000);
    if (secs < MIN_SESSION_SECONDS) return;
    alreadyLogged = true;
    post({
      event_type: "played_game",
      metadata: { game: game, duration_seconds: secs }
    }, true);
  }

  function markInteraction() { interacted = true; }
  window.addEventListener("pointerdown", markInteraction, { once: true, passive: true });
  window.addEventListener("keydown",     markInteraction, { once: true });
  window.addEventListener("touchstart",  markInteraction, { once: true, passive: true });


  // Fire an achievement unlock. Server dedupes, so this is safe to call
  // on every death / win — only the first ever lands a new entry.
  // (Arcade stats achievements are server-awarded; the API refuses them here.)
  window.unlockAchievement = function (achievementId) {
    try {
      fetch("/api/profile/me/achievements/" + encodeURIComponent(achievementId), {
        method: "POST",
        keepalive: true,
        credentials: "include",
        headers: authHeaders()
      }).catch(function () {});
    } catch (_) {}
  };

  window.addEventListener("pagehide", sessionFlush);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") sessionFlush();
  });
})();
