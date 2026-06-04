import { useTheme } from "../theme/ThemeContext";

/** Botón para alternar entre tema oscuro y claro. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="secondary icon-btn"
      onClick={toggle}
      title={isDark ? "Tema claro" : "Tema oscuro"}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
