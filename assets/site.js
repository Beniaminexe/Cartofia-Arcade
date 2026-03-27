(function () {
  /* ── OIDC configuration ──────────────────────────────────────────── */
  var OIDC_USERINFO_URL = "/application/o/userinfo/";
  var OIDC_LOGOUT_URL   = "/application/o/cartofia/end-session/";
  var OIDC_LOGIN_URL    = "/account/#login";
  var PROFILE_ME_URL    = "/api/profile/me";
  var ARCHIVE_ACCESS_GROUPS = ["archive_view", "archive_upload", "archive_admin"];
  var ARCHIVE_UPLOAD_GROUPS = ["archive_upload", "archive_admin"];

  function hasAnyGroup(groups, allowed) {
    var userGroups = Array.isArray(groups) ? groups : [];
    for (var i = 0; i < userGroups.length; i++) {
      if (allowed.indexOf(userGroups[i]) !== -1) {
        return true;
      }
    }
    return false;
  }

  function hasArchiveAccess(groups) {
    return hasAnyGroup(groups, ARCHIVE_ACCESS_GROUPS);
  }

  function hasArchiveUploadAccess(groups) {
    return hasAnyGroup(groups, ARCHIVE_UPLOAD_GROUPS);
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
      var token = typeof localStorage !== "undefined" ? localStorage.getItem("oidc_access_token") : null;
      var headers = token ? { "Authorization": "Bearer " + token } : {};
      var response = await fetch(OIDC_USERINFO_URL, {
        credentials: "include",
        headers: headers,
      });
      if (response.status === 401 || !response.ok) {
        return { authenticated: false };
      }
      var claims = await response.json();
      return {
        authenticated: true,
        user: {
          username: claims.preferred_username || claims.sub || "",
          email: claims.email || "",
          groups: claims.groups || [],
        },
      };
    } catch (_error) {
      return { authenticated: false };
    }
  }

  async function fetchProfile() {
    try {
      var token = typeof localStorage !== "undefined" ? localStorage.getItem("oidc_access_token") : null;
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

  function applyArchiveVisibility(session) {
    var groups = session && session.user ? session.user.groups : [];
    var canArchive = !!(session && session.authenticated && hasArchiveAccess(groups));
    var archiveLinks = document.querySelectorAll('a[href="/archive/"], [data-archive-link]');
    archiveLinks.forEach(function (element) {
      element.classList.toggle("hidden", !canArchive);
    });
    var archiveOnlyBlocks = document.querySelectorAll("[data-archive-only]");
    archiveOnlyBlocks.forEach(function (element) {
      element.classList.toggle("hidden", !canArchive);
    });
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
    const groups = session && session.user && Array.isArray(session.user.groups) ? session.user.groups : [];
    const canArchive = !!(session && session.authenticated && hasArchiveAccess(groups));
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
      if (canArchive) {
        addLink("Archive", "/archive/");
      }
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
        if (typeof localStorage !== "undefined") {
          localStorage.removeItem("oidc_access_token");
          localStorage.removeItem("oidc_id_token");
        }
        document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
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
      applyArchiveVisibility(session);
    });
  }

  function init() {
    applyArchiveVisibility({ authenticated: false, user: { groups: [] } });
    const menus = document.querySelectorAll("[data-account-menu]");
    menus.forEach(initAccountMenu);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
