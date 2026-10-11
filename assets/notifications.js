/*
  Site-wide notifications bell.

  Mounts a bell button + popover inside .nav-right on any page that has it,
  provided the user has a token. Polls /api/notifications every 60s. Click
  the bell to toggle the popover; click a notification row to mark it read
  and jump to the referenced thread/post.
*/
(function () {
  function token() {
    try { return sessionStorage.getItem('oidc_access_token') || localStorage.getItem('oidc_access_token'); }
    catch (_) { return null; }
  }
  if (!token()) return;

  const navRight = document.querySelector('.nav-right');
  if (!navRight || document.getElementById('cartofiaNotif')) return;

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
  // Insert before the account menu so the bell sits to its left.
  const accountMenu = navRight.querySelector('.account-menu');
  if (accountMenu) navRight.insertBefore(el, accountMenu);
  else             navRight.appendChild(el);

  const bell    = el.querySelector('.notif-bell');
  const pop     = el.querySelector('.notif-pop');
  const dot     = el.querySelector('.notif-dot');
  const listEl  = el.querySelector('#notifList');
  const markAll = el.querySelector('.notif-mark-all');

  function esc(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function relative(ts) {
    if (!ts) return '';
    let s = String(ts).replace(' ', 'T');
    if (!/Z$|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const secs = (Date.now() - d.getTime()) / 1000;
    if (secs < 60)    return 'just now';
    if (secs < 3600)  return Math.floor(secs / 60) + 'm';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h';
    if (secs < 604800) return Math.floor(secs / 86400) + 'd';
    return d.toLocaleDateString();
  }
  function kindLabel(k) {
    if (k === 'mention') return 'mentioned you';
    if (k === 'reply')   return 'replied to your thread';
    return k;
  }
  function hrefFor(n) {
    if (n.thread_id) return '/forum/thread/?id=' + n.thread_id;
    return '#';
  }

  async function fetchNotifs() {
    try {
      const r = await fetch('/api/notifications', {
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      if (!r.ok) throw new Error();
      const data = await r.json();
      render(data);
    } catch (_) { /* ignore */ }
  }

  function render(data) {
    const unread = data.unread || 0;
    dot.hidden = unread === 0;
    if (unread) dot.textContent = unread > 9 ? '9+' : String(unread);
    else        dot.textContent = '';

    const items = data.notifications || [];
    if (!items.length) {
      listEl.innerHTML = '<div class="notif-empty">Nothing yet.</div>';
      return;
    }
    listEl.innerHTML = items.map(n => {
      const actor = n.actor ? (n.actor.display_name || n.actor.username || 'Someone') : 'Someone';
      const avatar = n.actor && n.actor.avatar_url
        ? '<img src="' + esc(n.actor.avatar_url) + '" alt="" />'
        : '<div class="notif-avatar-fb">' + esc((actor || '?').slice(0, 2).toUpperCase()) + '</div>';
      const context = n.thread_title ? ' <em>' + esc(n.thread_title) + '</em>' : '';
      return `
        <a class="notif-row${n.read ? '' : ' unread'}" href="${hrefFor(n)}" data-id="${n.id}">
          <span class="notif-avatar">${avatar}</span>
          <span class="notif-body">
            <span class="notif-line"><strong>${esc(actor)}</strong> ${esc(kindLabel(n.kind))}${context}</span>
            <span class="notif-snip">${esc((n.body || '').slice(0, 120))}</span>
            <span class="notif-time">${esc(relative(n.created_at))}</span>
          </span>
        </a>`;
    }).join('');
  }

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

  listEl.addEventListener('click', async (ev) => {
    const row = ev.target.closest('.notif-row');
    if (!row) return;
    const id = parseInt(row.dataset.id, 10);
    if (!id) return;
    row.classList.remove('unread');
    try {
      await fetch('/api/notifications/' + id + '/read', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() }
      });
    } catch (_) {}
    // Let the native navigation proceed (href on <a>).
  });

  markAll.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() }
      });
      fetchNotifs();
    } catch (_) {}
  });

  fetchNotifs();
  setInterval(fetchNotifs, 60000);
})();
