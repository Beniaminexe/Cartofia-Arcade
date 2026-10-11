/*
  Site-wide theme loader.

  Reads the user's chosen accent theme (chosen on /account/profile/) and
  applies it on every page by setting CSS custom properties on <html>.
  Themes map to the same --accent / --accent-glow / --accent-soft / --accent-2
  / --accent-3 / --text-accent that assets/site.css already defaults.

  Flow:
    1. On parse (synchronous), read localStorage and apply immediately — no
       flash of default theme.
    2. If a signed-in session is present, fetch /api/profile/me and reconcile.
    3. The profile editor calls window.CartofiaTheme.apply(name, true) to
       change the theme; that persists it to the API and localStorage.
    4. storage events keep other open tabs in sync.
*/
(function () {
  var THEMES = {
    ocean:     { accent:"#3b82f6", accentGlow:"rgba(59,130,246,0.4)",  accentSoft:"rgba(59,130,246,0.15)",  accent2:"#06b6d4", accent3:"#8b5cf6", textAccent:"#7cb3ff" },
    neon:      { accent:"#a855f7", accentGlow:"rgba(168,85,247,0.4)",  accentSoft:"rgba(168,85,247,0.15)",  accent2:"#ec4899", accent3:"#f472b6", textAccent:"#d8b4fe" },
    ember:     { accent:"#f59e0b", accentGlow:"rgba(245,158,11,0.4)",  accentSoft:"rgba(245,158,11,0.15)",  accent2:"#ef4444", accent3:"#f97316", textAccent:"#fcd34d" },
    matrix:    { accent:"#22c55e", accentGlow:"rgba(34,197,94,0.4)",   accentSoft:"rgba(34,197,94,0.15)",   accent2:"#06b6d4", accent3:"#10b981", textAccent:"#86efac" },
    synthwave: { accent:"#e11d48", accentGlow:"rgba(225,29,72,0.4)",   accentSoft:"rgba(225,29,72,0.15)",   accent2:"#9333ea", accent3:"#ec4899", textAccent:"#fda4af" }
  };
  var THEME_NAMES = { ocean:"Deep Ocean", neon:"Neon Night", ember:"Ember", matrix:"Matrix", synthwave:"Synthwave" };
  var STORAGE_KEY = "cartofia_theme";

  function getToken() {
    try {
      return sessionStorage.getItem("oidc_access_token")
          || localStorage.getItem("oidc_access_token");
    } catch (_) { return null; }
  }

  function applyVars(name) {
    var t = THEMES[name];
    if (!t) return false;
    var r = document.documentElement;
    r.style.setProperty("--accent",       t.accent);
    r.style.setProperty("--accent-glow",  t.accentGlow);
    r.style.setProperty("--accent-soft",  t.accentSoft);
    r.style.setProperty("--accent-2",     t.accent2);
    r.style.setProperty("--accent-3",     t.accent3);
    r.style.setProperty("--text-accent",  t.textAccent);
    r.setAttribute("data-theme", name);
    return true;
  }

  function cached() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }
  function remember(name) {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (_) {}
  }

  /* 1. Apply cached theme synchronously so paint uses the right accents. */
  var initial = cached();
  if (initial) applyVars(initial);

  /* 2. Reconcile with server for signed-in sessions. Skip on /u/ pages so
     we don't race with the page's own "apply profile-owner's theme" code. */
  function syncFromServer() {
    if (location.pathname.indexOf("/u/") === 0) return;
    var tok = getToken();
    if (!tok) return;
    fetch("/api/profile/me", { headers: { "Authorization": "Bearer " + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        var p = data.profile || data;
        var theme = p && p.theme;
        if (theme && theme !== cached()) {
          applyVars(theme);
          remember(theme);
          document.dispatchEvent(new CustomEvent("cartofia:theme-changed", { detail: { theme: theme } }));
        }
      })
      .catch(function () {});
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncFromServer);
  } else {
    syncFromServer();
  }

  /* 3. Shared API for the profile editor + any future consumer. */
  window.CartofiaTheme = {
    THEMES: THEMES,
    THEME_NAMES: THEME_NAMES,
    current: function () { return cached() || "ocean"; },
    apply: function (name, save) {
      if (!applyVars(name)) return;
      remember(name);
      document.dispatchEvent(new CustomEvent("cartofia:theme-changed", { detail: { theme: name } }));
      if (save) {
        var tok = getToken();
        if (!tok) return;
        try {
          fetch("/api/profile/me", {
            method: "PUT",
            headers: {
              "Authorization": "Bearer " + tok,
              "Content-Type":  "application/json"
            },
            body: JSON.stringify({ theme: name })
          }).catch(function () {});
        } catch (_) {}
      }
    }
  };

  /* 4. Keep tabs in sync. */
  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY && e.newValue && e.newValue !== cached()) {
      applyVars(e.newValue);
    }
  });
})();
