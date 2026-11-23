/*
  "Stats & leaderboard" button + modal for arcade game pages.
  Needs /assets/game-stats.css. Works with game-utils.js (listens for the
  `cartofia:game-result` event to refresh and toast new achievements).

  API (arcade_stats.py):
    GET /api/arcade/games/<slug>                      game info + achievement list
    GET /api/arcade/games/<slug>/stats/me             personal stats (401 = guest)
    GET /api/arcade/games/<slug>/leaderboard?metric=  top players
*/
(function () {
  "use strict";
  var GAMES = ["snake", "minesweeper", "bomber-raid", "word-puzzle", "maze-chase",
               "blackjack", "zuma", "chess", "brick-blitz"];
  var m = location.pathname.match(/\/arcade\/([^\/?#]+)/);
  var slug = m ? m[1].toLowerCase() : "";
  if (GAMES.indexOf(slug) < 0) return;

  var API = "/api/arcade/games/" + encodeURIComponent(slug);
  var info = null, me = null, guest = false, board = null, metric = null;
  var overlay = null, lastFocus = null, stale = true, authed = null;

  function token() {
    try { return sessionStorage.getItem("oidc_access_token") || localStorage.getItem("oidc_access_token"); }
    catch (_) { return null; }
  }
  function getJSON(url) {
    var headers = {};
    var t = token();
    if (t) headers["Authorization"] = "Bearer " + t;
    return fetch(url, { credentials: "include", headers: headers }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, body: j }; });
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function fmtNum(n) { return n == null ? "—" : Number(n).toLocaleString("en-GB"); }
  function fmtTime(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    if (s < 60) return s + "s";
    var h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
    return h ? h + "h " + mm + "m" : mm + "m " + (s % 60) + "s";
  }
  function fmtAgo(iso) {
    if (!iso) return "—";
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(d)) return "—";
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + " min ago";
    if (d < 86400) return Math.floor(d / 3600) + " h ago";
    return Math.floor(d / 86400) + " d ago";
  }
  function metricLabel(k) {
    if (k === "best_score") return (info && info.score_label) ? "Best " + info.score_label.toLowerCase() : "Best score";
    return { wins: "Wins", games: "Games", playtime: "Time played" }[k] || k;
  }
  function metricValue(k, v) { return k === "playtime" ? fmtTime(v) : fmtNum(v); }

  function avatar(user, cls) {
    var wrap = el("span", "gs-avatar " + (cls || ""));
    var name = (user && (user.display_name || user.username)) || "?";
    if (user && user.avatar_url) {
      var img = el("img");
      img.src = user.avatar_url; img.alt = ""; img.loading = "lazy";
      img.onerror = function () { wrap.textContent = name.charAt(0).toUpperCase(); };
      wrap.appendChild(img);
    } else {
      wrap.textContent = name.charAt(0).toUpperCase();
    }
    return wrap;
  }

  // ---------------------------------------------------------------- render
  function renderMe(box) {
    box.textContent = "";
    box.appendChild(el("h3", "gs-h", "Your stats"));
    if (guest) {
      var p = el("p", "gs-muted");
      p.appendChild(document.createTextNode("Sign in to track your stats, climb the leaderboard and earn achievements. "));
      var a = el("a", "gs-link", "Sign in");
      a.href = "/account/#login";
      p.appendChild(a);
      box.appendChild(p);
      return;
    }
    if (!me) { box.appendChild(el("p", "gs-muted", "Loading…")); return; }
    var grid = el("div", "gs-tiles");
    function tile(label, value) {
      var t = el("div", "gs-tile");
      t.appendChild(el("span", "gs-tile-v", value));
      t.appendChild(el("span", "gs-tile-l", label));
      grid.appendChild(t);
    }
    tile("Games", fmtNum(me.games_played));
    if (!info || info.has_wins !== false) tile("Wins", fmtNum(me.wins));
    if (info && info.score_label) tile(metricLabel("best_score"), fmtNum(me.best_score));
    tile("Time played", fmtTime(me.total_playtime_seconds));
    if (me.best_streak > 1) tile("Best streak", fmtNum(me.best_streak));
    if (me.fastest_win_seconds) tile("Fastest win", fmtTime(me.fastest_win_seconds));
    tile("Rank", me.rank ? "#" + me.rank : "—");
    tile("Last played", fmtAgo(me.last_played_at));
    box.appendChild(grid);
    if (!me.games_played) box.appendChild(el("p", "gs-muted", "Finish a game to get on the board."));
  }

  function renderBoard(box) {
    box.textContent = "";
    var head = el("div", "gs-board-head");
    head.appendChild(el("h3", "gs-h", "Top 10"));
    var tabs = el("div", "gs-tabs");
    tabs.setAttribute("role", "tablist");
    ((info && info.metrics) || ["wins", "games", "playtime"]).forEach(function (k) {
      var b = el("button", "gs-tab" + (k === metric ? " active" : ""), metricLabel(k));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", k === metric ? "true" : "false");
      b.addEventListener("click", function () { if (k !== metric) { metric = k; loadBoard(); } });
      tabs.appendChild(b);
    });
    head.appendChild(tabs);
    box.appendChild(head);
    if (!board) { box.appendChild(el("p", "gs-muted", "Loading…")); return; }
    if (!board.length) { box.appendChild(el("p", "gs-muted", "No one on this board yet. Be the first!")); return; }
    var myName = me && me.user && me.user.username;
    var ol = el("ol", "gs-board");
    board.forEach(function (e) {
      var li = el("li", "gs-row" + (myName && e.username === myName ? " me" : ""));
      li.appendChild(el("span", "gs-rank", "#" + e.rank));
      var who = el("a", "gs-who");
      who.href = "/u/" + encodeURIComponent(e.username || "");
      who.appendChild(avatar(e));
      who.appendChild(el("span", "gs-name", e.display_name || e.username));
      li.appendChild(who);
      li.appendChild(el("span", "gs-val", metricValue(metric, e.value)));
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  function renderAch(box) {
    box.textContent = "";
    var list = (me && me.achievements) || (info && info.achievements) || [];
    var earned = list.filter(function (a) { return a.earned; }).length;
    box.appendChild(el("h3", "gs-h", "Achievements" + (guest ? "" : " · " + earned + "/" + list.length)));
    var grid = el("div", "gs-ach");
    list.forEach(function (a) {
      var card = el("a", "gs-ach-card" + (a.earned ? " earned" : " locked"));
      card.href = "/achievements/#" + encodeURIComponent(a.id);
      card.title = a.description;
      card.appendChild(el("span", "gs-ach-icon", a.icon));
      var txt = el("span", "gs-ach-txt");
      txt.appendChild(el("b", null, a.name));
      txt.appendChild(el("span", null, a.description));
      if (!a.earned && a.progress && a.progress.target > 1) {
        var bar = el("span", "gs-prog");
        var fill = el("i");
        fill.style.width = Math.round(100 * a.progress.current / a.progress.target) + "%";
        bar.appendChild(fill);
        txt.appendChild(bar);
        txt.appendChild(el("span", "gs-prog-l", fmtNum(a.progress.current) + " / " + fmtNum(a.progress.target)));
      }
      card.appendChild(txt);
      card.appendChild(el("span", "gs-ach-state", a.earned ? "Earned" : "Locked"));
      grid.appendChild(card);
    });
    box.appendChild(grid);
  }

  function render() {
    if (!overlay) return;
    renderMe(overlay.querySelector(".gs-me"));
    renderBoard(overlay.querySelector(".gs-lb"));
    renderAch(overlay.querySelector(".gs-achs"));
  }

  // ------------------------------------------------------------------ data
  function loadBoard() {
    board = null; render();
    return getJSON(API + "/leaderboard?limit=10&metric=" + encodeURIComponent(metric)).then(function (r) {
      board = (r.body && r.body.entries) || [];
      if (r.body && r.body.metric) metric = r.body.metric;
      render();
    }).catch(function () { board = []; render(); });
  }
  function loadAll() {
    stale = false;
    var pInfo = info ? Promise.resolve() : getJSON(API).then(function (r) {
      if (r.body && r.body.slug) info = r.body;
      if (!metric) metric = (info && info.primary_metric) || "wins";
    });
    return pInfo.then(function () {
      if (!metric) metric = "wins";
      // Ask /api/auth/me first so guests don't trigger a 401 in the console.
      var pAuth = authed !== null ? Promise.resolve() : getJSON("/api/auth/me").then(function (r) {
        authed = !!(r.body && r.body.authenticated) || !!token();
      }).catch(function () { authed = !!token(); });
      var pMe = pAuth.then(function () {
        if (!authed) { guest = true; me = null; return; }
        return getJSON(API + "/stats/me").then(function (r) {
          guest = r.status === 401;
          me = r.status === 200 ? r.body : null;
        });
      });
      return Promise.all([pMe, loadBoard()]).then(render);
    }).catch(function () { render(); });
  }

  // ----------------------------------------------------------------- modal
  function trapKeys(e) {
    if (!overlay || overlay.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") {
      var f = overlay.querySelectorAll("button, a[href]");
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    // Keep game controls (arrows, space, letters) from reaching the game.
    e.stopImmediatePropagation();
  }
  function build() {
    overlay = el("div", "gs-overlay");
    overlay.hidden = true;
    var dlg = el("div", "gs-dialog");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-labelledby", "gs-title");
    var top = el("div", "gs-top");
    var title = el("h2", "gs-title", ((info && info.name) || document.title.split(/[|·—-]/)[0].trim()) + " · Stats & leaderboard");
    title.id = "gs-title";
    var x = el("button", "gs-close", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", close);
    top.appendChild(title); top.appendChild(x);
    dlg.appendChild(top);
    var body = el("div", "gs-body");
    body.appendChild(el("section", "gs-sec gs-me"));
    body.appendChild(el("section", "gs-sec gs-lb"));
    body.appendChild(el("section", "gs-sec gs-achs"));
    dlg.appendChild(body);
    var foot = el("div", "gs-foot");
    var all = el("a", "gs-link", "All achievements →");
    all.href = "/achievements/";
    foot.appendChild(all);
    dlg.appendChild(foot);
    overlay.appendChild(dlg);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }
  function open() {
    if (!overlay) build();
    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add("gs-open");
    window.addEventListener("keydown", trapKeys, true);
    window.addEventListener("keyup", trapKeys, true);
    render();
    overlay.querySelector(".gs-close").focus();
    loadAll().then(function () {
      var t = overlay.querySelector(".gs-title");
      if (info && info.name) t.textContent = info.name + " · Stats & leaderboard";
    });
  }
  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    document.documentElement.classList.remove("gs-open");
    window.removeEventListener("keydown", trapKeys, true);
    window.removeEventListener("keyup", trapKeys, true);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) {} }
  }

  // ----------------------------------------------------------------- toast
  function toast(a) {
    var t = el("a", "gs-toast");
    t.href = "/achievements/#" + encodeURIComponent(a.id);
    t.setAttribute("role", "status");
    t.appendChild(el("span", "gs-toast-icon", a.icon));
    var txt = el("span", "gs-toast-txt");
    txt.appendChild(el("small", null, "Achievement unlocked"));
    txt.appendChild(el("b", null, a.name));
    t.appendChild(txt);
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 400); }, 5200);
  }

  window.addEventListener("cartofia:game-result", function (e) {
    var d = e.detail || {};
    if (!d.request || d.request.slug !== slug) return;
    var res = d.response || {};
    (res.new_achievements || []).forEach(function (a, i) { setTimeout(function () { toast(a); }, i * 700); });
    stale = true;
    if (overlay && !overlay.hidden) loadAll();
  });

  // --------------------------------------------------------------- buttons
  function makeBtn(cls) {
    var b = el("button", "gs-btn " + cls);
    b.type = "button";
    b.setAttribute("aria-haspopup", "dialog");
    b.appendChild(el("span", "gs-btn-icon", "📊"));
    b.appendChild(el("span", "gs-btn-txt", "Stats & leaderboard"));
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); open(); });
    return b;
  }
  function mount() {
    var header = document.querySelector(".game-header");
    if (header && !header.querySelector(".gs-btn")) {
      var stats = header.querySelector(".game-header-stats");
      var b = makeBtn("gs-btn-header");
      if (stats) header.insertBefore(b, stats); else header.appendChild(b);
    }
    var pre = document.querySelector(".pre-game-card");
    if (pre && !pre.querySelector(".gs-btn")) {
      var start = pre.querySelector(".start-btn");
      var pb = makeBtn("gs-btn-pre");
      if (start && start.parentNode === pre) start.insertAdjacentElement("afterend", pb); else pre.appendChild(pb);
    }
    var goActions = document.querySelector(".game-over-card .game-over-actions");
    if (goActions && !goActions.querySelector(".gs-btn")) goActions.appendChild(makeBtn("btn btn-ghost gs-btn-over"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.CartofiaGameStats = { open: open, close: close, refresh: loadAll };
})();
