// Aplica el último tema usado antes del primer pintado para evitar el parpadeo.
// Es un archivo aparte (no inline) porque la CSP de helmet bloquea scripts inline.
// Debe mantenerse en sincronía con src/theme/ThemeContext.tsx.
(function () {
  var pref = { palette: "cyan", mode: "dark" };
  try {
    var saved = JSON.parse(localStorage.getItem("dbkeeper.appearance") || "null");
    var legacy = localStorage.getItem("dbkeeper.theme");
    if (saved) pref = saved;
    else if (legacy === "dark" || legacy === "light") pref.mode = legacy;
  } catch (e) {
    /* sin storage: valores por defecto */
  }
  var dark =
    pref.mode === "system"
      ? !window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches
      : pref.mode !== "light";
  var root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-palette", pref.palette || "cyan");
})();
