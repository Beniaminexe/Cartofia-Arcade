(function () {
  function setExpanded(button, dropdown, expanded) {
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    dropdown.classList.toggle("hidden", !expanded);
  }

  async function fetchSession() {
    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      const payload = await response.json();
      if (!response.ok || !payload || !payload.authenticated) {
        return { authenticated: false };
      }
      return payload;
    } catch (_error) {
      return { authenticated: false };
    }
  }

  function renderAccountDropdown(menu, session) {
    const button = menu.querySelector("[data-account-toggle]");
    const dropdown = menu.querySelector("[data-account-dropdown]");
    if (!button || !dropdown) {
      return;
    }

    const username = session && session.user && session.user.username ? String(session.user.username) : null;
    const email = session && session.user && session.user.email ? String(session.user.email) : null;
    const initials = username ? username.slice(0, 2).toUpperCase() : "CA";
    button.textContent = initials;

    dropdown.innerHTML = "";
    const frag = document.createDocumentFragment();

    const head = document.createElement("div");
    head.className = "account-head";

    const avatar = document.createElement("div");
    avatar.className = "account-avatar";
    avatar.textContent = initials;
    head.appendChild(avatar);

    const identity = document.createElement("div");
    identity.className = "account-identity";
    const nameEl = document.createElement("div");
    nameEl.className = "account-name";
    nameEl.textContent = username || "Guest";
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
      addLink("Account", "/account/");
      addLink("Archive", "/archive/");
      addLink("Minecraft", "/minecraft/");
      addButton("Logout", { logout: "true" });
    } else {
      addLink("Login", "/account/#login", { accent: true });
      addLink("Register", "/account/#register");
      addLink("Archive", "/archive/");
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

    dropdown.addEventListener("click", async function (event) {
      const action = event.target && event.target.closest("[data-logout]");
      if (action) {
        event.preventDefault();
        try {
          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        } catch (_error) {
          // Ignore logout errors and fall back to local state change.
        }
        renderAccountDropdown(menu, { authenticated: false });
        setExpanded(button, dropdown, false);
        window.location.href = "/account/";
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

    fetchSession().then(function (session) {
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
