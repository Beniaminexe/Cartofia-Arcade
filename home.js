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

  /**
   * Activate a specific tab by its data-tab value.
   * @param {string} targetId  e.g. "arcade", "minecraft"
   */
  function activateTab(targetId) {
    // Deactivate every button and panel
    tabBtns.forEach(function (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('tabindex', '-1');
    });
    tabPanels.forEach(function (panel) {
      panel.classList.remove('active');
    });

    // Activate the target
    var targetBtn   = document.querySelector('.tab-btn[data-tab="' + targetId + '"]');
    var targetPanel = document.getElementById('tab-' + targetId);

    if (targetBtn) {
      targetBtn.classList.add('active');
      targetBtn.setAttribute('aria-selected', 'true');
      targetBtn.setAttribute('tabindex', '0');
    }
    if (targetPanel) {
      targetPanel.classList.add('active');
    }
  }

  // Click handler
  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activateTab(btn.dataset.tab);
    });
  });

  // Keyboard: Left/Up = previous tab, Right/Down = next tab
  tabBtns.forEach(function (btn, index) {
    btn.addEventListener('keydown', function (e) {
      var count = tabBtns.length;
      var next;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        next = (index + 1) % count;
        tabBtns[next].focus();
        activateTab(tabBtns[next].dataset.tab);
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        next = (index - 1 + count) % count;
        tabBtns[next].focus();
        activateTab(tabBtns[next].dataset.tab);
        e.preventDefault();
      } else if (e.key === 'Home') {
        tabBtns[0].focus();
        activateTab(tabBtns[0].dataset.tab);
        e.preventDefault();
      } else if (e.key === 'End') {
        tabBtns[count - 1].focus();
        activateTab(tabBtns[count - 1].dataset.tab);
        e.preventDefault();
      }
    });
  });

  // Initialise tabindex: only active tab in focus order
  tabBtns.forEach(function (btn) {
    if (!btn.classList.contains('active')) {
      btn.setAttribute('tabindex', '-1');
    }
  });


  /* --------------------------------------------------
     2. HAMBURGER / MOBILE NAV
  -------------------------------------------------- */

  var hamburger = document.getElementById('hamburger');
  var mobileNav = document.getElementById('mobileNav');

  if (hamburger && mobileNav) {

    function openMenu() {
      hamburger.setAttribute('aria-expanded', 'true');
      mobileNav.classList.remove('hidden');
      mobileNav.setAttribute('aria-hidden', 'false');
    }

    function closeMenu() {
      hamburger.setAttribute('aria-expanded', 'false');
      mobileNav.classList.add('hidden');
      mobileNav.setAttribute('aria-hidden', 'true');
    }

    hamburger.addEventListener('click', function () {
      if (hamburger.getAttribute('aria-expanded') === 'true') {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Close when clicking outside nav or hamburger
    document.addEventListener('click', function (e) {
      if (
        hamburger.getAttribute('aria-expanded') === 'true' &&
        !hamburger.contains(e.target) &&
        !mobileNav.contains(e.target)
      ) {
        closeMenu();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && hamburger.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        hamburger.focus();
      }
    });

    // Close when a mobile nav link is clicked
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { closeMenu(); });
    });
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

  var navLinks = document.querySelectorAll('.nav-links a, .mobile-nav a');
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

})();
