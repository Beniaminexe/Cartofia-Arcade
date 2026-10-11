(function () {
  /* OIDC configuration */
  var OIDC_USERINFO_URL = "/application/o/userinfo/";
  var OIDC_TOKEN_URL    = "/application/o/token/";
  var OIDC_CLIENT_ID    = "cartofia";
  var OIDC_LOGOUT_URL   = "/application/o/cartofia/end-session/";
  var OIDC_LOGIN_URL    = "/account/#login";
  var PROFILE_ME_URL    = "/api/profile/me";

  function getStoredToken(key) {
    try {
      if (typeof sessionStorage !== "undefined") {
        var sessionValue = sessionStorage.getItem(key);
        if (sessionValue) return sessionValue;
      }
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
      }
    } catch (_error) {
      return null;
    }
    return null;
  }

  /* Returns { token, storage: "session"|"local" } or null */
  function getStoredRefreshToken() {
    try {
      if (typeof sessionStorage !== "undefined") {
        var v = sessionStorage.getItem("oidc_refresh_token");
        if (v) return { token: v, storage: "session" };
      }
      if (typeof localStorage !== "undefined") {
        var v = localStorage.getItem("oidc_refresh_token");
        if (v) return { token: v, storage: "local" };
      }
    } catch (_) {}
    return null;
  }

  function clearStoredTokens() {
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("oidc_access_token");
        sessionStorage.removeItem("oidc_id_token");
        sessionStorage.removeItem("oidc_refresh_token");
      }
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("oidc_access_token");
        localStorage.removeItem("oidc_id_token");
        localStorage.removeItem("oidc_refresh_token");
        localStorage.removeItem("cartofia_remember");
      }
    } catch (_error) {
      return;
    }
  }

  /* Silently exchange a stored refresh token for a new access token.
     Writes the new tokens back to the same storage tier (local or session).
     Returns the new access token string, or null on failure. */
  /* Decode a JWT access token and return seconds until exp, or null. */
  function tokenSecondsLeft(token) {
    if (!token || typeof token !== "string") return null;
    var parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      var payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (payload.length % 4) payload += "=";
      var claims = JSON.parse(atob(payload));
      if (!claims.exp) return null;
      return Math.max(0, claims.exp - Math.floor(Date.now() / 1000));
    } catch (_) { return null; }
  }

  var _refreshTimer = null;
  var _inFlightRefresh = null;

  function scheduleProactiveRefresh(accessToken) {
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    var secsLeft = tokenSecondsLeft(accessToken);
    if (secsLeft == null) return;
    /* Refresh 60s before expiry; clamp to a reasonable window */
    var delayMs = Math.max(10, secsLeft - 60) * 1000;
    _refreshTimer = setTimeout(function () { refreshTokensSilently(); }, delayMs);
  }

  async function refreshTokensSilently() {
    /* Collapse concurrent refresh attempts into one in-flight promise. */
    if (_inFlightRefresh) return _inFlightRefresh;
    var stored = getStoredRefreshToken();
    if (!stored) return null;
    _inFlightRefresh = (async function () {
      try {
        var resp = await fetch(OIDC_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type:    "refresh_token",
            client_id:     OIDC_CLIENT_ID,
            refresh_token: stored.token,
            scope:         "openid profile email groups offline_access",
          }),
        });
        if (!resp.ok) {
          var body = await resp.text().catch(function () { return ""; });
          console.warn("[cartofia] refresh failed:", resp.status, body);
          /* Only clear tokens if the refresh token itself is dead.
             invalid_grant / 400 / 401 = user must re-login. */
          if (resp.status === 400 || resp.status === 401) clearStoredTokens();
          return null;
        }
        var tokens = await resp.json();
        var store = stored.storage === "local" ? localStorage : sessionStorage;
        store.setItem("oidc_access_token", tokens.access_token);
        if (tokens.id_token) store.setItem("oidc_id_token", tokens.id_token);
        if (tokens.refresh_token) store.setItem("oidc_refresh_token", tokens.refresh_token);
        /* Mirror the cookie that server-side auth reads. */
        document.cookie = "access_token=" + tokens.access_token
          + "; path=/; SameSite=Strict; Secure";
        scheduleProactiveRefresh(tokens.access_token);
        return tokens.access_token;
      } catch (err) {
        console.warn("[cartofia] refresh threw:", err);
        return null;
      } finally {
        _inFlightRefresh = null;
      }
    })();
    return _inFlightRefresh;
  }

  /* On load, kick off a proactive refresh schedule from whatever access
     token is already stored. If the token has already expired, this does
     a refresh immediately so API calls on the page start out valid. */
  (function bootstrapRefresh() {
    var tok = getStoredToken("oidc_access_token");
    if (!tok) return;
    var left = tokenSecondsLeft(tok);
    if (left == null) return;
    if (left < 120) refreshTokensSilently();
    else            scheduleProactiveRefresh(tok);
  })();

  /* Global fetch wrapper — on any 401 from /api/* with Authorization: Bearer,
     silently refresh the token and retry once. Pages that use `fetch()`
     normally keep working across token expiry without having to know. */
  (function wrapFetchFor401() {
    var orig = window.fetch;
    if (!orig || orig.__cartofiaWrapped) return;
    async function wrapped(input, init) {
      var resp = await orig(input, init);
      try {
        if (resp.status !== 401) return resp;
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (!url.startsWith("/api/")) return resp;
        var hadAuth = !!(init && init.headers &&
          (init.headers.Authorization || init.headers.authorization));
        if (!hadAuth) return resp;
        var newToken = await refreshTokensSilently();
        if (!newToken) return resp;
        /* Shallow-clone init with the new header. */
        var retryInit = Object.assign({}, init || {});
        retryInit.headers = Object.assign({}, (init && init.headers) || {}, {
          Authorization: "Bearer " + newToken,
        });
        return await orig(input, retryInit);
      } catch (_) {
        return resp;
      }
    }
    wrapped.__cartofiaWrapped = true;
    window.fetch = wrapped;
  })();

  function initialsFrom(username) {
    var value = username ? String(username).trim() : "";
    return value ? value.slice(0, 2).toUpperCase() : "CA";
  }

  /* Render avatar: uses <img> when a URL is available, initials text otherwise. */
  function setAvatarVisual(target, initials, avatarUrl) {
    if (!target) return;
    /* Remove any previously injected avatar img */
    var existingImg = target.querySelector("img.avatar-img");
    if (existingImg) existingImg.remove();

    target.style.backgroundImage = "";

    if (avatarUrl) {
      target.classList.add("has-image");
      target.textContent = "";
      var img = document.createElement("img");
      img.className = "avatar-img";
      img.src = String(avatarUrl);
      img.alt = initials || "Avatar";
      target.appendChild(img);
      return;
    }
    target.classList.remove("has-image");
    target.textContent = initials || "CA";
  }

  function setExpanded(button, dropdown, expanded) {
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    dropdown.classList.toggle("hidden", !expanded);
  }

  async function fetchSession() {
    try {
      var token = getStoredToken("oidc_access_token");
      var headers = token ? { "Authorization": "Bearer " + token } : {};
      var response = await fetch(OIDC_USERINFO_URL, {
        credentials: "include",
        headers: headers,
      });

      /* Access token expired — try a silent refresh before giving up */
      if (response.status === 401 && token) {
        var newToken = await refreshTokensSilently();
        if (!newToken) return { authenticated: false };
        var retryResp = await fetch(OIDC_USERINFO_URL, {
          credentials: "include",
          headers: { "Authorization": "Bearer " + newToken },
        });
        if (!retryResp.ok) return { authenticated: false };
        var retryClaims = await retryResp.json();
        return {
          authenticated: true,
          user: {
            username: retryClaims.preferred_username || retryClaims.sub || "",
            email:    retryClaims.email || "",
            groups:   retryClaims.groups || [],
          },
        };
      }

      if (response.status === 401 || !response.ok) {
        return { authenticated: false };
      }
      var claims = await response.json();
      return {
        authenticated: true,
        user: {
          username: claims.preferred_username || claims.sub || "",
          email:    claims.email || "",
          groups:   claims.groups || [],
        },
      };
    } catch (_error) {
      return { authenticated: false };
    }
  }

  async function fetchProfile() {
    try {
      var token = getStoredToken("oidc_access_token");
      if (!token) return null;
      var response = await fetch(PROFILE_ME_URL, {
        credentials: "include",
        headers: { "Authorization": "Bearer " + token },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  var sessionPromise = null;
  function fetchSessionBundle() {
    if (!sessionPromise) {
      sessionPromise = (async function () {
        var session = await fetchSession();
        if (!session || !session.authenticated || !session.user) {
          return { authenticated: false };
        }
        /* fetchProfile() returns { profile: {...}, showcases, stats, activity } */
        var data = await fetchProfile();
        if (data && data.profile) {
          session.user.avatar_url   = data.profile.avatar_url   || "";
          session.user.display_name = data.profile.display_name || session.user.username;
        }
        return session;
      })();
    }
    return sessionPromise;
  }

  function renderAccountDropdown(menu, session) {
    const button = menu.querySelector("[data-account-toggle]");
    const dropdown = menu.querySelector("[data-account-dropdown]");
    if (!button || !dropdown) {
      return;
    }

    const username = session && session.user && session.user.username ? String(session.user.username) : null;
    const displayName = session && session.user && session.user.display_name ? String(session.user.display_name) : null;
    const email = session && session.user && session.user.email ? String(session.user.email) : null;
    const avatarUrl = session && session.user && session.user.avatar_url ? String(session.user.avatar_url) : "";
    const initials = initialsFrom(displayName || username);
    setAvatarVisual(button, initials, avatarUrl);

    dropdown.innerHTML = "";
    const frag = document.createDocumentFragment();

    const head = document.createElement("div");
    head.className = "account-head";

    const avatar = document.createElement("div");
    avatar.className = "account-avatar";
    setAvatarVisual(avatar, initials, avatarUrl);
    head.appendChild(avatar);

    const identity = document.createElement("div");
    identity.className = "account-identity";
    const nameEl = document.createElement("div");
    nameEl.className = "account-name";
    nameEl.textContent = displayName || username || "Guest";
    const emailEl = document.createElement("div");
    emailEl.className = "account-email";
    emailEl.textContent = email || "Not signed in";
    identity.appendChild(nameEl);
    identity.appendChild(emailEl);
    head.appendChild(identity);
    frag.appendChild(head);

    const actions = document.createElement("div");
    actions.className = "account-actions";

    const addLink = (label, href, options = {}) => {
      const link = document.createElement("a");
      link.className = "account-item";
      link.href = href;
      link.setAttribute("role", "menuitem");
      if (options.accent) {
        link.classList.add("accent");
      }
      link.textContent = label;
      actions.appendChild(link);
    };

    const addButton = (label, dataset) => {
      const btn = document.createElement("button");
      btn.className = "account-item account-action";
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      Object.assign(btn.dataset, dataset);
      btn.textContent = label;
      actions.appendChild(btn);
    };

    if (session && session.authenticated && username) {
      addLink("Profile", "/account/profile/");
      addLink("Account", "/account/");
      addLink("Minecraft", "/minecraft/");
      addButton("Logout", { logout: "true" });
    } else {
      addLink("Sign In", OIDC_LOGIN_URL, { accent: true });
    }

    frag.appendChild(actions);
    dropdown.appendChild(frag);
  }

  function initAccountMenu(menu) {
    const button = menu.querySelector("[data-account-toggle]");
    const dropdown = menu.querySelector("[data-account-dropdown]");

    if (!button || !dropdown) {
      return;
    }

    setExpanded(button, dropdown, false);
    renderAccountDropdown(menu, { authenticated: false });

    button.addEventListener("click", function (event) {
      event.preventDefault();
      const isOpen = !dropdown.classList.contains("hidden");
      setExpanded(button, dropdown, !isOpen);
    });

    dropdown.addEventListener("click", function (event) {
      var action = event.target && event.target.closest("[data-logout]");
      if (action) {
        event.preventDefault();
        clearStoredTokens();
        document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict; Secure";
        renderAccountDropdown(menu, { authenticated: false });
        setExpanded(button, dropdown, false);
        window.location.href = OIDC_LOGOUT_URL;
      }
    });

    document.addEventListener("click", function (event) {
      if (!menu.contains(event.target)) {
        setExpanded(button, dropdown, false);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        setExpanded(button, dropdown, false);
      }
    });

    fetchSessionBundle().then(function (session) {
      renderAccountDropdown(menu, session);
    });
  }

  function init() {
    const menus = document.querySelectorAll("[data-account-menu]");
    menus.forEach(initAccountMenu);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

// --- Presence heartbeat ---
(function() {
  var visitorId = localStorage.getItem('cartofia_visitor_id');
  if (!visitorId) {
    visitorId = (crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      }));
    localStorage.setItem('cartofia_visitor_id', visitorId);
  }
  function sendHeartbeat() {
    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId, page: window.location.pathname })
    }).catch(function() {});
  }
  sendHeartbeat();
  setInterval(sendHeartbeat, 60000);
})();
