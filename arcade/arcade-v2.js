/* ============================================================
   Cartofia Arcade v2 — landing page behaviour
   - filters (aria-pressed buttons)
   - live "N playing" counts from /api/online/games (30 s poll)
   - top players per card: /api/arcade/games (+ Ludo leaderboard)
   - "Jump back in" strip for signed-in users (/api/arcade/stats/me)
   Self-contained; depends only on site.js's fetch wrapper (cookies).
   ============================================================ */
(function () {
  'use strict';

  var grid = document.getElementById('gamesGrid');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.ax-card'));
  var bySlug = {};
  cards.forEach(function (c) { bySlug[c.dataset.slug] = c; });

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function authHeaders() {
    var h = {};
    try {
      var t = sessionStorage.getItem('oidc_access_token') || localStorage.getItem('oidc_access_token');
      if (t) h.Authorization = 'Bearer ' + t;
    } catch (_) {}
    return h;
  }
  function getJSON(url) {
    return fetch(url, { credentials: 'include', headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function fmtNum(n) {
    n = Number(n);
    if (!isFinite(n)) return '';
    return n.toLocaleString('en-GB');
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec < 60) return sec + 's';
    var m = Math.round(sec / 60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm';
  }
  function timeAgo(iso) {
    if (!iso) return '';
    var t = Date.parse(iso.indexOf('T') === -1 && iso.indexOf('Z') === -1 ? iso.replace(' ', 'T') + 'Z' : iso);
    if (isNaN(t)) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    var d = Math.round(s / 86400);
    return d === 1 ? 'yesterday' : d + 'd ago';
  }
  function initials(name) {
    var v = String(name || '').trim();
    if (!v) return '?';
    var parts = v.split(/[\s_\-.]+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : v.slice(0, 2)).toUpperCase();
  }
  function cardName(card) {
    var a = card && card.querySelector('.ax-card-link');
    return a ? a.textContent.trim() : '';
  }

  /* Hide a cover if its art is missing, so the gradient fallback shows. */
  document.querySelectorAll('.ax img').forEach(function (img) {
    img.addEventListener('error', function () { img.classList.add('is-broken'); }, { once: true });
  });

  /* ---------- filters ---------- */
  var filterBtns = Array.prototype.slice.call(document.querySelectorAll('.ax-filter'));
  var filterStatus = document.querySelector('[data-filter-status]');
  function applyFilter(mode) {
    var shown = 0;
    cards.forEach(function (c) {
      var ok = mode === 'all' || c.dataset.mode === mode;
      c.hidden = !ok;
      if (ok) shown++;
    });
    filterBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.filter === mode ? 'true' : 'false'); });
    if (filterStatus) filterStatus.textContent = shown + (shown === 1 ? ' game' : ' games') + ' shown';
  }
  filterBtns.forEach(function (b) {
    b.addEventListener('click', function () { applyFilter(b.dataset.filter); });
  });

  /* ---------- live player counts ---------- */
  var totalEl = document.querySelector('[data-total-live]');
  var totalText = document.querySelector('[data-total-live-text]');
  function renderCounts(games) {
    var total = 0;
    cards.forEach(function (card) {
      var n = Number(games[card.dataset.slug] || 0);
      total += n;
      var pill = card.querySelector('[data-live]');
      if (!pill) return;
      var label = pill.querySelector('[data-live-text]');
      if (n > 0) {
        label.textContent = n + ' playing';
        pill.setAttribute('aria-label', n + (n === 1 ? ' person' : ' people') + ' playing now');
        pill.hidden = false;
      } else {
        pill.hidden = true;
      }
    });
    if (totalEl && totalText) {
      totalEl.classList.toggle('is-live', total > 0);
      if (total > 0) {
        totalText.textContent = '';
        var strong = el('strong', null, total === 1 ? '1 player' : fmtNum(total) + ' players');
        totalText.appendChild(strong);
        totalText.appendChild(document.createTextNode(' in a game right now'));
      } else {
        totalText.textContent = "It's quiet in here — start a game and be the first.";
      }
    }
  }
  function updateCounts() {
    getJSON('/api/online/games').then(function (data) {
      renderCounts((data && data.games) || {});
    });
  }
  updateCounts();
  setInterval(updateCounts, 30000);

  /* ---------- top players ---------- */
  function avatarLink(p, metric) {
    var name = p.display_name || p.username || 'Player';
    var a = el(p.username ? 'a' : 'span', 'ax-ava');
    if (p.username) a.href = '/u/' + encodeURIComponent(p.username);
    var val = p.value != null ? fmtNum(p.value) + (metric ? ' ' + metric : '') : '';
    var label = name + (val ? ' — ' + val : '');
    a.title = label;
    a.setAttribute('aria-label', label);
    if (p.avatar_url) {
      var img = el('img');
      img.src = p.avatar_url;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', function () { img.remove(); a.textContent = initials(name); }, { once: true });
      a.appendChild(img);
    } else {
      a.textContent = initials(name);
    }
    return a;
  }
  function renderTop(card, top, opts) {
    var slot = card.querySelector('[data-top]');
    if (!slot) return;
    slot.textContent = '';
    top = (top || []).slice(0, 3);
    if (!top.length) {
      if (opts.flagship) {
        slot.appendChild(el('span', 'ax-top-empty', 'The flagship'));
      } else {
        slot.appendChild(el('span', 'ax-top-empty', opts.loaded ? 'No champions yet — claim #1' : ''));
      }
      return;
    }
    var stack = el('div', 'ax-avatars');
    stack.setAttribute('role', 'list');
    stack.setAttribute('aria-label', 'Top players in ' + cardName(card));
    top.forEach(function (p) {
      var a = avatarLink(p, opts.metric);
      a.setAttribute('role', 'listitem');
      stack.appendChild(a);
    });
    var lab = el('span', 'ax-top-label', 'Leaders');
    if (opts.players_total > 0) {
      lab.appendChild(el('b', null, fmtNum(opts.players_total) + (opts.players_total === 1 ? ' player' : ' players')));
    } else {
      var first = top[0];
      lab.appendChild(el('b', null, '#1 ' + (first.display_name || first.username || '')));
    }
    slot.appendChild(stack);
    slot.appendChild(lab);
  }

  var METRIC_LABEL = { best_score: 'pts', wins: 'wins', games: 'games', playtime: 's' };
  function loadTopPlayers() {
    Promise.all([
      getJSON('/api/arcade/games'),
      getJSON('/api/ludo/leaderboard?sort=wins&limit=3')
    ]).then(function (res) {
      var games = res[0];
      if (games && !Array.isArray(games)) games = games.games || games.items || [];
      var map = {};
      (games || []).forEach(function (g) { if (g && g.slug) map[g.slug] = g; });

      var ludo = res[1] && Array.isArray(res[1].entries) ? res[1].entries : [];
      if (ludo.length) {
        map.ludo = {
          slug: 'ludo',
          metric: 'wins',
          top: ludo.map(function (e) {
            return { username: e.username, display_name: e.display_name, avatar_url: e.avatar_url, value: e.wins };
          })
        };
      }

      cards.forEach(function (card) {
        var slug = card.dataset.slug;
        var g = map[slug] || {};
        var pm = g.primary_metric || g.metric;
        var metric = pm === 'best_score'
          ? String(g.score_label || 'pts').toLowerCase()
          : (METRIC_LABEL[pm] || '');
        renderTop(card, g.top, {
          loaded: true,
          flagship: slug === 'cartofia',
          metric: metric,
          players_total: Number(g.players_total) || 0
        });
      });
    });
  }
  loadTopPlayers();

  /* ---------- signed-in strip / guest nudge ---------- */
  var recent = document.getElementById('recent');
  var recentList = recent && recent.querySelector('[data-recent-list]');
  var nudge = document.getElementById('nudge');

  function renderRecent(stats) {
    var games = (stats && Array.isArray(stats.games)) ? stats.games.slice() : [];
    games = games.filter(function (g) { return g && g.game && bySlug[g.game]; });
    if (!games.length || !recentList) return false;
    games.sort(function (a, b) { return String(b.last_played || '').localeCompare(String(a.last_played || '')); });
    recentList.textContent = '';
    games.slice(0, 4).forEach(function (g) {
      var card = bySlug[g.game];
      var li = el('li', 'ax-recent-item');
      li.style.setProperty('--g', card.style.getPropertyValue('--g'));
      var a = el('a');
      a.href = '/arcade/' + g.game + '/';
      var img = el('img');
      img.src = '/assets/games/' + g.game + '.svg';
      img.alt = '';
      img.width = 72; img.height = 45;
      img.addEventListener('error', function () { img.classList.add('is-broken'); }, { once: true });
      var txt = el('span');
      txt.appendChild(el('span', 'ax-recent-name', cardName(card) || g.display_name || g.game));
      var bits = [];
      var ago = timeAgo(g.last_played);
      if (ago) bits.push(ago);
      var n = Number(g.total_sessions) || 0;
      if (n) bits.push(n === 1 ? '1 session' : n + ' sessions');
      if (g.total_playtime_seconds) bits.push(fmtDuration(g.total_playtime_seconds));
      txt.appendChild(el('span', 'ax-recent-meta', bits.join(' · ')));
      a.appendChild(img);
      a.appendChild(txt);
      li.appendChild(a);
      recentList.appendChild(li);
    });
    recent.hidden = false;
    return true;
  }

  getJSON('/api/auth/me').then(function (me) {
    var signedIn = !!(me && me.authenticated);
    if (!signedIn) {
      try { signedIn = !!(sessionStorage.getItem('oidc_access_token') || localStorage.getItem('oidc_access_token')); } catch (_) {}
    }
    if (!signedIn) {
      if (nudge) nudge.hidden = false;
      return;
    }
    getJSON('/api/arcade/stats/me').then(renderRecent);
  });
})();
