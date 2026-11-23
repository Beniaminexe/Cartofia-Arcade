/*
  Site-wide notifications bell + toasts.

  Mounts a bell button + popover in the nav (inside .nav-right when the page
  has one, else next to the account avatar) for signed-in users (httpOnly
  cartofia_session cookie, or a legacy stored JWT). Polls /api/notifications
  every 45 s while the tab is visible (paused when hidden, refreshed on
  return). New unread items (friend requests, accepted requests, forum
  mentions/replies) also pop a toast once. Friend requests can be accepted or
  declined straight from the bell or the toast.

  Fires `cartofia:friends-changed` on window when friend state may have
  changed, so pages showing a friends list can refresh it.
*/
(async function () {
  const POLL_MS = 45000;
  const SEEN_KEY = 'cartofia_notif_toasted';

  function token() {
    try { return sessionStorage.getItem('oidc_access_token') || localStorage.getItem('oidc_access_token'); }
    catch (_) { return null; }
  }
  function authHeaders(extra) {
    const t = token();
    const h = Object.assign({}, extra || {});
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }
  if (!token()) {
    window.__cartofiaSignedIn = window.__cartofiaSignedIn || fetch('/api/auth/me', { credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return !!(d && d.authenticated); })
        .catch(function () { return false; });
    if (!(await window.__cartofiaSignedIn)) return;
  }

  if (document.getElementById('cartofiaNotif')) return;
  const navRight = document.querySelector('.nav-right');
  const avatarAnchor = navRight ? null
    : (document.querySelector('.nav .account-menu') || document.querySelector('.nav #navAvatar, .nav .nav-avatar'));
  if (!navRight && !avatarAnchor) return;

  const el = document.createElement('div');
  el.className = 'notif-widget';
  el.id = 'cartofiaNotif';
  el.innerHTML = `
    <button class="notif-bell" type="button" aria-label="Notifications" aria-haspopup="menu" aria-expanded="false">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
      </svg>
      <span class="notif-dot" hidden></span>
    </button>
    <div class="notif-pop hidden" role="menu" aria-label="Notifications">
      <div class="notif-pop-head">
        <strong>Notifications</strong>
        <button class="notif-mark-all" type="button">Mark all read</button>
      </div>
      <div class="notif-pop-body" id="notifList">
        <div class="notif-empty">Loading…</div>
      </div>
    </div>
  `;
  if (navRight) {
    const accountMenu = navRight.querySelector('.account-menu');
    if (accountMenu) navRight.insertBefore(el, accountMenu);
    else             navRight.insertBefore(el, navRight.firstChild);
  } else {
    avatarAnchor.parentNode.insertBefore(el, avatarAnchor);
  }

  const bell    = el.querySelector('.notif-bell');
  const pop     = el.querySelector('.notif-pop');
  const dot     = el.querySelector('.notif-dot');
  const listEl  = el.querySelector('#notifList');
  const markAll = el.querySelector('.notif-mark-all');

  let toastHost = null;
  let lastData = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function parseTs(ts) {
    let s = String(ts || '').replace(' ', 'T');
    if (s && !/Z$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function relative(ts) {
    const d = parseTs(ts);
    if (!d) return '';
    const secs = (Date.now() - d.getTime()) / 1000;
    if (secs < 60)    return 'just now';
    if (secs < 3600)  return Math.floor(secs / 60) + 'm';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h';
    if (secs < 604800) return Math.floor(secs / 86400) + 'd';
    return d.toLocaleDateString();
  }
  function kindLabel(k) {
    if (k === 'mention')         return 'mentioned you';
    if (k === 'reply')           return 'replied to your thread';
    if (k === 'friend_request')  return 'sent you a friend request';
    if (k === 'friend_accepted') return 'accepted your friend request';
    return k;
  }
  function hrefFor(n) {
    if (n.link) return n.link;
    if (n.kind === 'friend_request') return '/account/profile/#friends';
    if (n.kind === 'friend_accepted' && n.actor && n.actor.username) return '/u/' + encodeURIComponent(n.actor.username);
    if (n.thread_id) return '/forum/thread/?id=' + n.thread_id;
    return '#';
  }
  function actorName(n) {
    return n.actor ? (n.actor.display_name || n.actor.username || 'Someone') : 'Someone';
  }
  function avatarHtml(n) {
    const name = actorName(n);
    return n.actor && n.actor.avatar_url
      ? '<img src="' + esc(n.actor.avatar_url) + '" alt="" />'
      : '<div class="notif-avatar-fb">' + esc((name || '?').slice(0, 2).toUpperCase()) + '</div>';
  }
  function pendingRequest(n) {
    return n.kind === 'friend_request' && !n.read && n.actor && n.actor.username;
  }
  function friendButtons(n) {
    if (!pendingRequest(n)) return '';
    return '<span class="notif-actions">'
      + '<button type="button" class="notif-act notif-accept" data-friend="accept" data-user="' + esc(n.actor.username) + '" data-id="' + n.id + '">Accept</button>'
      + '<button type="button" class="notif-act" data-friend="decline" data-user="' + esc(n.actor.username) + '" data-id="' + n.id + '">Decline</button>'
      + '</span>';
  }

  async function fetchNotifs() {
    try {
      const r = await fetch('/api/notifications', { credentials: 'include', headers: authHeaders() });
      if (!r.ok) throw new Error();
      const data = await r.json();
      lastData = data;
      render(data);
      maybeToast(data.notifications || []);
    } catch (_) { /* ignore */ }
  }

  function render(data) {
    const unread = data.unread || 0;
    dot.hidden = unread === 0;
    dot.textContent = unread ? (unread > 9 ? '9+' : String(unread)) : '';
    bell.setAttribute('aria-label', unread ? 'Notifications (' + unread + ' unread)' : 'Notifications');

    const items = data.notifications || [];
    if (!items.length) {
      listEl.innerHTML = '<div class="notif-empty">Nothing yet.</div>';
      return;
    }
    listEl.innerHTML = items.map(n => {
      const context = n.thread_title ? ' <em>' + esc(n.thread_title) + '</em>' : '';
      const snip = n.body ? '<span class="notif-snip">' + esc(n.body.slice(0, 120)) + '</span>' : '';
      return `
        <div class="notif-row${n.read ? '' : ' unread'}" data-id="${n.id}">
          <a class="notif-link" href="${esc(hrefFor(n))}" data-id="${n.id}">
            <span class="notif-avatar">${avatarHtml(n)}</span>
            <span class="notif-body">
              <span class="notif-line"><strong>${esc(actorName(n))}</strong> ${esc(kindLabel(n.kind))}${context}</span>
              ${snip}
              <span class="notif-time">${esc(relative(n.created_at))}</span>
            </span>
          </a>
          ${friendButtons(n)}
        </div>`;
    }).join('');
  }

  async function markRead(id) {
    try {
      await fetch('/api/notifications/' + id + '/read', { method: 'POST', credentials: 'include', headers: authHeaders() });
    } catch (_) {}
  }

  async function friendAction(action, username, id) {
    const r = await fetch('/api/profile/me/friends/' + encodeURIComponent(username), {
      method: 'PATCH',
      credentials: 'include',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: action }),
    });
    if (id) await markRead(id);
    window.dispatchEvent(new CustomEvent('cartofia:friends-changed', { detail: { action: action, username: username } }));
    await fetchNotifs();
    return r.ok;
  }

  /* ── Toasts ─────────────────────────────────────────────── */
  function readSeen() {
    try { const v = parseInt(localStorage.getItem(SEEN_KEY) || '', 10); return isNaN(v) ? null : v; }
    catch (_) { return null; }
  }
  function writeSeen(v) { try { localStorage.setItem(SEEN_KEY, String(v)); } catch (_) {} }

  function maybeToast(items) {
    if (!items.length) return;
    const maxId = items.reduce((m, n) => Math.max(m, n.id || 0), 0);
    let seen = readSeen();
    let fresh;
    if (seen === null) {
      // First visit on this browser: only surface things from the last 10 minutes.
      fresh = items.filter(n => {
        const d = parseTs(n.created_at);
        return !n.read && d && (Date.now() - d.getTime()) < 600000;
      });
    } else {
      fresh = items.filter(n => !n.read && n.id > seen);
    }
    if (maxId > (seen || 0)) writeSeen(maxId);
    if (!fresh.length) return;
    if (fresh.some(n => n.kind === 'friend_request' || n.kind === 'friend_accepted')) {
      window.dispatchEvent(new CustomEvent('cartofia:friends-changed', { detail: { action: 'notification' } }));
    }
    fresh.slice(0, 2).reverse().forEach(showToast);
  }

  function showToast(n) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'notif-toasts';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    const t = document.createElement('div');
    t.className = 'notif-toast notif-toast-' + String(n.kind || '').replace(/[^a-z_]/g, '');
    t.innerHTML = `
      <span class="notif-avatar">${avatarHtml(n)}</span>
      <span class="notif-body">
        <span class="notif-line"><strong>${esc(actorName(n))}</strong> ${esc(kindLabel(n.kind))}</span>
        <span class="notif-actions">
          ${pendingRequest(n) ? friendButtons(n).replace(/^<span class="notif-actions">|<\/span>$/g, '') : ''}
          <a class="notif-act" href="${esc(hrefFor(n))}" data-id="${n.id}">View</a>
        </span>
      </span>
      <button type="button" class="notif-toast-close" aria-label="Dismiss">×</button>`;
    toastHost.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    let timer = setTimeout(close, 9000);
    function close() {
      clearTimeout(timer);
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }
    t.addEventListener('mouseenter', () => clearTimeout(timer));
    t.addEventListener('mouseleave', () => { timer = setTimeout(close, 4000); });
    t.querySelector('.notif-toast-close').addEventListener('click', close);
    t.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-friend]');
      if (b) {
        ev.preventDefault();
        b.disabled = true;
        const ok = await friendAction(b.dataset.friend, b.dataset.user, parseInt(b.dataset.id, 10));
        const line = t.querySelector('.notif-line');
        if (line) line.textContent = ok ? (b.dataset.friend === 'accept' ? 'You are now friends with ' + actorName(n) : 'Request declined') : 'That request is no longer pending';
        t.querySelectorAll('[data-friend]').forEach(x => x.remove());
        timer = setTimeout(close, 3000);
        return;
      }
      const a = ev.target.closest('a[data-id]');
      if (a) markRead(parseInt(a.dataset.id, 10));
    });
  }

  /* ── Wiring ─────────────────────────────────────────────── */
  bell.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = !pop.classList.contains('hidden');
    pop.classList.toggle('hidden', open);
    bell.setAttribute('aria-expanded', String(!open));
    if (!open) fetchNotifs();
  });

  document.addEventListener('click', (ev) => {
    if (el.contains(ev.target)) return;
    pop.classList.add('hidden');
    bell.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !pop.classList.contains('hidden')) {
      pop.classList.add('hidden');
      bell.setAttribute('aria-expanded', 'false');
      bell.focus();
    }
  });

  listEl.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-friend]');
    if (b) {
      ev.preventDefault();
      ev.stopPropagation();
      b.disabled = true;
      await friendAction(b.dataset.friend, b.dataset.user, parseInt(b.dataset.id, 10));
      return;
    }
    const link = ev.target.closest('.notif-link');
    if (!link) return;
    const id = parseInt(link.dataset.id, 10);
    if (!id) return;
    const row = link.closest('.notif-row');
    if (row) row.classList.remove('unread');
    markRead(id);   // native navigation proceeds (href on <a>)
  });

  markAll.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include', headers: authHeaders() });
      fetchNotifs();
    } catch (_) {}
  });

  // Poll while visible; pause in background tabs, catch up on return.
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(fetchNotifs, POLL_MS);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopPolling();
    else { fetchNotifs(); startPolling(); }
  });
  // Pages that change friend state themselves can ask for a refresh.
  window.addEventListener('cartofia:notifications-refresh', fetchNotifs);

  fetchNotifs();
  if (document.visibilityState !== 'hidden') startPolling();
})();
