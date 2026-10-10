/*
  Shared helpers for arcade game pages.

  Primary API:
    window.logGameActivity(metadata)  — call at win/loss with
      { game, result?, score?, duration_seconds? } to record an entry.

  Secondary (automatic) behaviour — session fallback:
    If a visitor opens a game, interacts with it, stays for 15s+, and
    leaves without the game ever calling logGameActivity (e.g. they quit
    mid-round, or the game has no end-of-round hook like Cartofia), one
    `played_game` entry is still recorded on pagehide / visibility-hidden.
    The game slug is derived from the URL (/arcade/<slug>/...).

  Hook for games with a non-trivial "game actually started" moment:
    window.__markGameStart()
  Example: Cartofia WASM — call this when the splash hides, so the recorded
  duration reflects play time rather than load time.
*/
(function () {
  var startedAt   = Date.now();
  var interacted  = false;
  var alreadyLogged = false;
  var MIN_SESSION_SECONDS = 15;

  function getToken() {
    try {
      return sessionStorage.getItem("oidc_access_token")
          || localStorage.getItem("oidc_access_token");
    } catch (_) { return null; }
  }

  function post(payload, useKeepalive) {
    var token = getToken();
    if (!token) return;
    var init = {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify(payload)
    };
    if (useKeepalive) init.keepalive = true;
    try { fetch("/api/profile/me/activity", init).catch(function () {}); }
    catch (_) {}
  }

  window.__markGameStart = function () { startedAt = Date.now(); };

  window.logGameActivity = async function (data) {
    alreadyLogged = true;
    post({ event_type: "played_game", metadata: data }, false);
  };

  function deriveGameSlug() {
    var m = location.pathname.match(/\/arcade\/([^\/?#]+)/);
    return m ? m[1] : null;
  }

  function sessionFlush() {
    if (alreadyLogged || !interacted) return;
    var secs = Math.round((Date.now() - startedAt) / 1000);
    if (secs < MIN_SESSION_SECONDS) return;
    var game = deriveGameSlug();
    if (!game) return;
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

  window.addEventListener("pagehide", sessionFlush);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") sessionFlush();
  });
})();
