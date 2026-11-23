/* ============================================================
   CARTOFIA HOME — SCRIPT (Night Market layout, Batch 3)
   Pure vanilla JS, no dependencies.
   1. "What's inside": tabs on desktop, accordion ≤768px
   2. Scroll reveal ([data-reveal])
   3. Footer year
   4. "Tonight on Cartofia" feed   — GET /api/homepage/feed (60 s)
   5. Online counters               — GET /api/online, /api/online/games (30 s)
   6. Minecraft status              — GET /api/minecraft/info (60 s)
   7. Latest forum thread           — GET /api/forum/threads?limit=1
   8. Guest / signed-in greeting    — GET /api/auth/me
   ============================================================ */

(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------
     1. FEATURE SHOWCASE TABS / MOBILE ACCORDION
  -------------------------------------------------- */

  var tabBtns   = document.querySelectorAll('.tab-btn');
  var tabPanels = document.querySelectorAll('.tab-panel');
  var showcaseTabs    = document.querySelector('.showcase-tabs');
  var showcaseContent = document.querySelector('.showcase-content');
  /* ≤768px the tabs become an accordion (panels sit under their button). */
  var accordionMQ     = window.matchMedia('(max-width: 768px)');

  function isAccordion() { return accordionMQ.matches; }

  /* Keep ARIA in step with the current mode:
     - desktop: tablist / tab (aria-selected, roving tabindex) / tabpanel
     - accordion: plain disclosure buttons (aria-expanded) / region */
  function syncAria() {
    var acc = isAccordion();
    if (showcaseTabs) {
      if (acc) showcaseTabs.removeAttribute('role');
      else showcaseTabs.setAttribute('role', 'tablist');
    }
    tabBtns.forEach(function (btn) {
      var on = btn.classList.contains('active');
      if (acc) {
        btn.removeAttribute('role');
        btn.removeAttribute('aria-selected');
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        btn.setAttribute('tabindex', '0');
      } else {
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.removeAttribute('aria-expanded');
        btn.setAttribute('tabindex', on ? '0' : '-1');
      }
    });
    tabPanels.forEach(function (panel) {
      panel.setAttribute('role', acc ? 'region' : 'tabpanel');
      if (acc) panel.setAttribute('aria-hidden', panel.classList.contains('active') ? 'false' : 'true');
      else panel.removeAttribute('aria-hidden');
    });
  }

  /**
   * Activate a specific tab by its data-tab value (or close everything
   * when targetId is null — accordion mode only).
   * @param {string|null} targetId  e.g. "arcade", "minecraft"
   */
  function activateTab(targetId) {
    tabBtns.forEach(function (btn) { btn.classList.remove('active'); });
    tabPanels.forEach(function (panel) { panel.classList.remove('active'); });

    if (targetId) {
      var targetBtn   = document.querySelector('.tab-btn[data-tab="' + targetId + '"]');
      var targetPanel = document.getElementById('tab-' + targetId);
      if (targetBtn) targetBtn.classList.add('active');
      if (targetPanel) targetPanel.classList.add('active');
    }
    syncAria();
  }

  // Click: tabs on desktop; toggle open/closed in accordion mode
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (isAccordion() && btn.classList.contains('active')) {
        activateTab(null);
      } else {
        activateTab(btn.dataset.tab);
      }
    });
  });

  // Keyboard (desktop tabs only): Left/Up = previous, Right/Down = next.
  // In accordion mode the buttons are ordinary buttons (Tab + Enter/Space).
  tabBtns.forEach(function (btn, index) {
    btn.addEventListener('keydown', function (e) {
      if (isAccordion()) return;
      var count = tabBtns.length;
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % count;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + count) % count;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = count - 1;
      if (next === null) return;
      tabBtns[next].focus();
      activateTab(tabBtns[next].dataset.tab);
      e.preventDefault();
    });
  });

  /* Mobile: nest each panel directly after its button; desktop: panels
     live in .showcase-content. Re-runs on breakpoint changes. */
  function arrangePanels() {
    if (!showcaseTabs || !showcaseContent) return;
    if (isAccordion()) {
      tabBtns.forEach(function (btn) {
        var panel = document.getElementById('tab-' + btn.dataset.tab);
        if (!panel) return;
        if (panel.previousElementSibling !== btn) {
          btn.insertAdjacentElement('afterend', panel);
        }
      });
    } else {
      tabPanels.forEach(function (panel) {
        if (panel.parentNode !== showcaseContent) {
          showcaseContent.appendChild(panel);
        }
      });
      // Tabs always show one panel — reopen the first if all were closed
      if (!document.querySelector('.tab-btn.active') && tabBtns.length) {
        activateTab(tabBtns[0].dataset.tab);
        return;
      }
    }
    syncAria();
  }

  /* Deep links like /#tab-messages (used by every page's nav) open the
     matching section and bring it into view. */
  function openFromHash() {
    var m = /^#tab-([\w-]+)$/.exec(window.location.hash || '');
    if (!m || !document.getElementById('tab-' + m[1])) return;
    activateTab(m[1]);
    var target = isAccordion()
      ? document.querySelector('.tab-btn[data-tab="' + m[1] + '"]')
      : document.getElementById('showcase');
    if (target) {
      requestAnimationFrame(function () {
        target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
  }

  arrangePanels();
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
  if (accordionMQ.addEventListener) {
    accordionMQ.addEventListener('change', arrangePanels);
  } else if (accordionMQ.addListener) {
    accordionMQ.addListener(arrangePanels);
  }


  /* --------------------------------------------------
     2. SCROLL REVEAL — content stays visible without JS
     or with reduced motion; otherwise fades up once.
  -------------------------------------------------- */

  var revealEls = document.querySelectorAll('[data-reveal]');
  if (!reduceMotion && 'IntersectionObserver' in window && revealEls.length) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.remove('is-pending');
          revealObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) return; // already on screen: leave it be
      el.classList.add('is-pending');
      revealObs.observe(el);
    });
  }


  /* --------------------------------------------------
     3. COPYRIGHT YEAR
  -------------------------------------------------- */

  var yearEl = document.querySelector('.footer-copy');
  if (yearEl) {
    yearEl.textContent = '© ' + new Date().getFullYear() + ' Cartofia. Built on a homelab.';
  }


  /* --------------------------------------------------
     helpers
  -------------------------------------------------- */

  function authHeaders() {
    var h = {};
    try {
      var t = sessionStorage.getItem('oidc_access_token') || localStorage.getItem('oidc_access_token');
      if (t) h.Authorization = 'Bearer ' + t;
    } catch (_) {}
    return h;
  }
  function getJSON(url, withAuth) {
    var opts = withAuth ? { credentials: 'include', headers: authHeaders() } : {};
    return fetch(url, opts)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtNum(n) {
    n = Number(n);
    return isFinite(n) ? n.toLocaleString('en-GB') : '–';
  }
  function hhmm(d) {
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }


  /* --------------------------------------------------
     4. TONIGHT ON CARTOFIA FEED (built with textContent — API
     strings are never parsed as HTML)
  -------------------------------------------------- */

  var feedList = document.querySelector('.feed-list');
  var feedUpdated = document.querySelector('[data-feed-updated]');

  function loadFeed() {
    if (!feedList) return;
    getJSON('/api/homepage/feed').then(function (data) {
      var items = data && Array.isArray(data.items) && data.items.length ? data.items : null;
      if (!items) return; // keep whatever is showing
      var frag = document.createDocumentFragment();
      items.forEach(function (item) {
        var li = el('li');
        if (item.icon) {
          var icon = el('span', 'feed-icon', String(item.icon));
          icon.setAttribute('aria-hidden', 'true');
          li.appendChild(icon);
        }
        li.appendChild(el('span', 'feed-text', String(item.text || '')));
        frag.appendChild(li);
      });
      feedList.textContent = '';
      feedList.appendChild(frag);
      if (feedUpdated) feedUpdated.textContent = ' · refreshed ' + hhmm(new Date());
    });
  }
  loadFeed();
  setInterval(loadFeed, 60000);


  /* --------------------------------------------------
     5. ONLINE COUNTERS
  -------------------------------------------------- */

  var arcadeStat = document.querySelector('[data-door-arcade]');
  var arcadeDefault = arcadeStat ? arcadeStat.textContent : '';

  function updateOnline() {
    getJSON('/api/online').then(function (data) {
      var node = document.getElementById('online-count');
      if (node && data && data.count != null) node.textContent = fmtNum(data.count);
    });
    getJSON('/api/online/games').then(function (data) {
      var games = (data && data.games) || {};
      var total = 0;
      Object.keys(games).forEach(function (k) { total += Number(games[k]) || 0; });
      var node = document.getElementById('ingame-count');
      if (node && data) node.textContent = fmtNum(total);
      if (arcadeStat) {
        arcadeStat.textContent = total > 0
          ? (total === 1 ? '1 player' : fmtNum(total) + ' players') + ' in a game now'
          : arcadeDefault;
        arcadeStat.classList.toggle('is-hot', total > 0);
      }
    });
  }
  updateOnline();
  setInterval(updateOnline, 30000);


  /* --------------------------------------------------
     6. MINECRAFT STATUS (public, cached server-side)
  -------------------------------------------------- */

  function updateMinecraft() {
    getJSON('/api/minecraft/info').then(function (data) {
      var running = data ? data.running : null;
      var state = running === true ? 'awake' : running === false ? 'asleep' : 'unknown';
      var short = { awake: 'Awake', asleep: 'Asleep', unknown: '—' }[state];
      var long = {
        awake: 'Server awake' + (data && data.version ? ' · ' + data.version : ''),
        asleep: 'Asleep · wakes on demand',
        unknown: 'Status unavailable'
      }[state];

      var counter = document.getElementById('mc-state');
      if (counter) {
        counter.textContent = short;
        counter.dataset.state = state;
        counter.title = long;
      }
      var door = document.querySelector('[data-door-mc]');
      if (door && state !== 'unknown') {
        door.textContent = long;
        door.classList.toggle('is-hot', state === 'awake');
      }
      var dot = document.querySelector('[data-mc-dot]');
      if (dot) dot.dataset.state = state;
      var label = document.querySelector('[data-mc-label]');
      if (label) label.textContent = state === 'unknown' ? 'Unavailable' : short;
    });
  }
  updateMinecraft();
  setInterval(updateMinecraft, 60000);


  /* --------------------------------------------------
     7. LATEST FORUM THREAD (adds a real link to the Forum door)
  -------------------------------------------------- */

  getJSON('/api/forum/threads?limit=1').then(function (data) {
    var t = data && Array.isArray(data.threads) ? data.threads[0] : null;
    var slot = document.querySelector('[data-door-forum]');
    if (!t || !slot || !t.title) return;
    slot.textContent = '';
    slot.appendChild(document.createTextNode('Latest: '));
    var a = el('a', 'hm-door-thread', String(t.title));
    a.href = '/forum/thread/?id=' + encodeURIComponent(t.id);
    slot.appendChild(a);
  });


  /* --------------------------------------------------
     8. GUEST / SIGNED-IN GREETING
  -------------------------------------------------- */

  getJSON('/api/auth/me', true).then(function (me) {
    var signedIn = !!(me && me.authenticated && me.user);
    var guest = document.querySelector('[data-hello-guest]');
    var member = document.querySelector('[data-hello-member]');
    if (signedIn && member) {
      var name = member.querySelector('[data-hello-name]');
      if (name) name.textContent = me.user.username || 'friend';
      member.hidden = false;
    } else if (!signedIn && guest && me && !authHeaders().Authorization) {
      // (legacy token sessions aren't visible to /api/auth/me — say nothing then)
      guest.hidden = false;
    }
  });

})();
