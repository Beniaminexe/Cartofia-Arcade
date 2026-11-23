/* ============================================================
   CARTOFIA HOME — SCRIPT
   Pure vanilla JS, no dependencies.
   ============================================================ */

(function () {
  'use strict';


  /* --------------------------------------------------
     1. FEATURE SHOWCASE TABS
     Clicking a tab button shows its panel via opacity
     transition. Keyboard: Arrow keys cycle tabs.
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

  /* Deep links like #tab-messages open the matching section. */
  function openFromHash() {
    var m = /^#tab-([\w-]+)$/.exec(window.location.hash || '');
    if (m && document.getElementById('tab-' + m[1])) activateTab(m[1]);
  }
  window.addEventListener('hashchange', openFromHash);


  /* --------------------------------------------------
     2. MOBILE ACCORDION REARRANGE
     On screens ≤768px, move each tab panel directly
     after its corresponding tab button so it sits inline
     under the tab that opened it. On wider screens, move
     all panels back into .showcase-content for the
     side-by-side desktop layout. Reacts to resize so the
     layout stays correct after rotation or window resize.
  -------------------------------------------------- */

  function arrangePanels() {
    if (!showcaseTabs || !showcaseContent) return;
    if (isAccordion()) {
      // Mobile: nest each panel directly after its tab button
      tabBtns.forEach(function (btn) {
        var panel = document.getElementById('tab-' + btn.dataset.tab);
        if (!panel) return;
        if (panel.previousElementSibling !== btn) {
          btn.insertAdjacentElement('afterend', panel);
        }
      });
    } else {
      // Desktop: panels go back into .showcase-content
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

  arrangePanels();
  openFromHash();
  // matchMedia.addEventListener is the modern API; addListener fallback for old Safari
  if (accordionMQ.addEventListener) {
    accordionMQ.addEventListener('change', arrangePanels);
  } else if (accordionMQ.addListener) {
    accordionMQ.addListener(arrangePanels);
  }


  /* --------------------------------------------------
     3. SCROLL REVEAL (IntersectionObserver)
     Elements with class "reveal" start hidden (via CSS)
     and gain class "visible" when they enter the viewport.
  -------------------------------------------------- */

  var revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && revealEls.length) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObs.unobserve(entry.target); // fire once only
        }
      });
    }, {
      threshold:  0.1,
      rootMargin: '0px 0px -52px 0px'
    });

    revealEls.forEach(function (el) { revealObs.observe(el); });
  } else {
    // Graceful fallback: show everything immediately
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }


  /* --------------------------------------------------
     4. NAV ACTIVE LINK (scroll-based highlight)
     Updates which nav link is "active" as the user
     scrolls through sections.
  -------------------------------------------------- */

  var navLinks = document.querySelectorAll('.nav-links a');
  var sections = document.querySelectorAll('section[id]');

  if (navLinks.length && sections.length) {
    var lastActive = '';

    function updateActiveNav() {
      var scrollY = window.scrollY + 120; // offset for fixed nav height
      var currentId = '';

      sections.forEach(function (section) {
        if (section.offsetTop <= scrollY) {
          currentId = section.id;
        }
      });

      if (currentId === lastActive) return; // nothing changed
      lastActive = currentId;

      navLinks.forEach(function (link) {
        var href = link.getAttribute('href') || '';
        var isMatch = href === '#' + currentId ||
                      (currentId === 'hero' && link.textContent.trim() === 'Home');
        link.classList.toggle('active', isMatch);
      });
    }

    window.addEventListener('scroll', updateActiveNav, { passive: true });
    updateActiveNav(); // run once on load
  }


  /* --------------------------------------------------
     5. COPYRIGHT YEAR
  -------------------------------------------------- */

  var yearEl = document.querySelector('.footer-copy');
  if (yearEl) {
    yearEl.textContent = '© ' + new Date().getFullYear() + ' Cartofia. Built on a homelab.';
  }


  /* --------------------------------------------------
     6. TONIGHT ON CARTOFIA FEED
     Fetches live data from /api/homepage/feed and
     replaces the hardcoded placeholder items.
  -------------------------------------------------- */

  (async function loadFeed() {
    var feedList = document.querySelector('.feed-list');
    if (!feedList) return;
    try {
      var res = await fetch('/api/homepage/feed');
      if (!res.ok) throw new Error('non-200');
      var data = await res.json();
      var items = Array.isArray(data.items) && data.items.length ? data.items : null;
      if (items) {
        feedList.innerHTML = items.map(function (item) {
          var icon = item.icon
            ? '<span class="feed-icon" aria-hidden="true">' + item.icon + '</span>'
            : '';
          return '<li>' + icon + (item.text || '') + '</li>';
        }).join('');
      }
    } catch (_) {
      // Leave the fallback content already in the HTML
    }
  })();



  /* --------------------------------------------------
     7. PLAYERS ONLINE COUNTER
     Polls /api/online every 30 seconds and updates
     the stat-value element with id="online-count".
  -------------------------------------------------- */

  function updateOnlineCount() {
    fetch('/api/online')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var el = document.getElementById('online-count');
        if (el) el.textContent = data.count;
      })
      .catch(function() {});
  }
  updateOnlineCount();
  setInterval(updateOnlineCount, 30000);

})();
