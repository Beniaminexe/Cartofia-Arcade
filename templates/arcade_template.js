/* ============================================================
   CARTOFIA ARCADE — TEMPLATE SCRIPT
   Pure vanilla JS, no dependencies.
   Mirrors homepage script patterns: scroll-reveal, hamburger,
   year stamp. Adds: filter pills + smooth-scroll CTA.
   ============================================================ */

(function () {
  'use strict';


  /* --------------------------------------------------
     1. FILTER PILLS
     Click a pill to filter the games grid. Cards that
     don't match the filter get the .filter-hidden class
     (CSS handles the fade + collapse).
  -------------------------------------------------- */

  var pills    = document.querySelectorAll('.filter-pill');
  var gameCards = document.querySelectorAll('.game-card');

  function applyFilter(mode) {
    // Toggle pill active state
    pills.forEach(function (p) {
      var isActive = p.dataset.filter === mode;
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Toggle card visibility (fade out, then collapse via CSS)
    gameCards.forEach(function (card) {
      var cardMode = card.dataset.mode || 'single';
      var show = (mode === 'all') || (cardMode === mode);
      card.classList.toggle('filter-hidden', !show);
    });
  }

  pills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      applyFilter(pill.dataset.filter);
    });
  });


  /* --------------------------------------------------
     2. SMOOTH SCROLL — "Jump to Games" CTA
     Browser handles smooth scroll via html { scroll-behavior: smooth }
     for normal in-page hrefs. This handler exists so any element
     with data-scroll-to="<id>" also works (e.g. buttons that
     aren't <a> tags, or links with a custom interaction).
  -------------------------------------------------- */

  document.querySelectorAll('[data-scroll-to]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      var targetId = el.dataset.scrollTo;
      var target = document.getElementById(targetId);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });


  /* --------------------------------------------------
     3. HAMBURGER / MOBILE NAV (shared pattern)
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

    document.addEventListener('click', function (e) {
      if (
        hamburger.getAttribute('aria-expanded') === 'true' &&
        !hamburger.contains(e.target) &&
        !mobileNav.contains(e.target)
      ) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && hamburger.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        hamburger.focus();
      }
    });

    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { closeMenu(); });
    });
  }


  /* --------------------------------------------------
     4. SCROLL REVEAL (shared pattern)
  -------------------------------------------------- */

  var revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && revealEls.length) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, {
      threshold:  0.1,
      rootMargin: '0px 0px -52px 0px'
    });

    revealEls.forEach(function (el) { revealObs.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }


  /* --------------------------------------------------
     5. COPYRIGHT YEAR
  -------------------------------------------------- */

  var yearEl = document.querySelector('.footer-copy');
  if (yearEl) {
    yearEl.textContent = '© ' + new Date().getFullYear() + ' Cartofia. Built on a homelab.';
  }

})();
