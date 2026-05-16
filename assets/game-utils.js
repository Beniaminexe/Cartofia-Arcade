(function () {
  function _getToken() {
    try {
      var t = sessionStorage.getItem("oidc_access_token");
      if (t) return t;
      return localStorage.getItem("oidc_access_token");
    } catch (_) { return null; }
  }

  window.logGameActivity = async function (data) {
    var token = _getToken();
    if (!token) return;
    try {
      await fetch("/api/profile/me/activity", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_type: "played_game", metadata: data }),
      });
    } catch (_) {}
  };
})();
