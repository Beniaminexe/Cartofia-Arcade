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
    const initials = username ? username.slice(0, 2).toUpperCase() : "AC";
    button.textContent = initials;

    dropdown.innerHTML = "";
    const frag = document.createDocumentFragment();

    const addMeta = (text) => {
      const meta = document.createElement("div");
      meta.className = "account-meta";
      meta.textContent = text;
      frag.appendChild(meta);
    };

    const addLink = (label, href) => {
      const link = document.createElement("a");
      link.className = "account-item";
      link.href = href;
      link.setAttribute("role", "menuitem");
      link.textContent = label;
      frag.appendChild(link);
    };

    const addLogout = () => {
      const btn = document.createElement("button");
      btn.className = "account-item account-action";
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.dataset.logout = "true";
      btn.textContent = "Logout";
      frag.appendChild(btn);
    };

    if (session && session.authenticated && username) {
      addMeta(`Signed in as ${username}`);
      addLink("Account", "/account/");
      addLink("Archive", "/archive/");
      addLogout();
    } else {
      addMeta("You are not signed in.");
      addLink("Login", "/account/#login");
      addLink("Register", "/account/#register");
      addLink("Account Home", "/account/");
      addLink("Archive", "/archive/");
    }

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
