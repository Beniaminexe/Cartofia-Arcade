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
  async function refreshTokensSilently() {
    var stored = getStoredRefreshToken();
    if (!stored) return null;
    try {
      var resp = await fetch(OIDC_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "refresh_token",
          client_id:     OIDC_CLIENT_ID,
          refresh_token: stored.token,
        }),
      });
      if (!resp.ok) {
        clearStoredTokens();
        return null;
      }
      var tokens = await resp.json();
      var store = stored.storage === "local" ? localStorage : sessionStorage;
      store.setItem("oidc_access_token", tokens.access_token);
      if (tokens.id_token) store.setItem("oidc_id_token", tokens.id_token);
      if (tokens.refresh_token) store.setItem("oidc_refresh_token", tokens.refresh_token);
      return tokens.access_token;
    } catch (_) {
      clearStoredTokens();
      return null;
    }
  }

  function initialsFrom(username) {
    var value = username ? String(username).trim() : "";
    return value ? value.slice(0, 2).toUpperCase() : "CA";
  }

  function setAvatarVisual(target, initials, avatarUrl) {
    if (!target) return;
    if (avatarUrl) {
      target.classList.add("has-image");
      target.style.backgroundImage = "url('" + String(avatarUrl).replace(/'/g, "%27") + "')";
      target.textContent = "";
      return;
    }
    target.classList.remove("has-image");
    target.style.backgroundImage = "";
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
        var profile = await fetchProfile();
        if (profile) {
          session.user.avatar_url = profile.avatar_url || "";
          session.user.display_name = profile.display_name || session.user.username;
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
