import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { UI_MODES, UI_PALETTES, type UiMode, type UiPalette } from "@dbkeeper/shared";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

/** Modo efectivo aplicado en <html data-theme>. */
export type Theme = "dark" | "light";

/**
 * Paletas disponibles. Los colores reales viven en styles.css; `swatch` (fondo,
 * panel, acento) solo se usa para la vista previa en Configuración.
 */
export const PALETTES: { id: UiPalette; label: string; swatch: Record<Theme, [string, string, string]> }[] = [
  { id: "cyan", label: "Cyan", swatch: { dark: ["#0f1117", "#1a1d27", "#06b6d4"], light: ["#f4f6f9", "#ffffff", "#0891b2"] } },
  { id: "indigo", label: "Índigo", swatch: { dark: ["#0e0e18", "#181828", "#818cf8"], light: ["#f5f5fc", "#ffffff", "#4f46e5"] } },
  { id: "emerald", label: "Esmeralda", swatch: { dark: ["#0c1210", "#151e1b", "#34d399"], light: ["#f3f7f5", "#ffffff", "#059669"] } },
];

interface Pref {
  palette: UiPalette;
  mode: UiMode;
}

interface ThemeState {
  palette: UiPalette;
  mode: UiMode;
  /** Modo efectivo (resuelve "system"). */
  theme: Theme;
  setPalette: (p: UiPalette) => void;
  setMode: (m: UiMode) => void;
  toggle: () => void;
}

const DEFAULT_PREF: Pref = { palette: "cyan", mode: "dark" };
// La preferencia de cada usuario vive en la BD (auth.users.preferred_palette /
// preferred_theme). LAST_KEY es solo una copia local del último tema aplicado para
// que public/theme-init.js lo pinte antes de cargar la app (también en el login).
const LAST_KEY = "dbkeeper.appearance";
// Versión anterior: solo modo oscuro/claro en localStorage; se migra a la BD.
const LEGACY_KEY = "dbkeeper.theme";

const isPalette = (v: unknown): v is UiPalette => UI_PALETTES.includes(v as UiPalette);
const isMode = (v: unknown): v is UiMode => UI_MODES.includes(v as UiMode);

function readLastPref(): Pref | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    if (saved && isPalette(saved.palette) && isMode(saved.mode)) return saved;
  } catch {
    // storage no disponible o valor corrupto
  }
  return null;
}

function writeLastPref(pref: Pref) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(pref));
  } catch {
    // sin storage: solo se pierde el pintado previo a cargar la app
  }
}

/** Toma (y elimina) el modo que guardaba la versión anterior. */
function takeLegacyMode(): UiMode | null {
  try {
    const v = localStorage.getItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_KEY);
    return isMode(v) ? v : null;
  } catch {
    return null;
  }
}

const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");

const ThemeCtx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { identity } = useAuth();
  const user = identity?.user ?? null;
  const [pref, setPref] = useState<Pref>(() => readLastPref() ?? DEFAULT_PREF);
  const [osDark, setOsDark] = useState(() => darkQuery()?.matches ?? true);

  // Al iniciar sesión aplica la preferencia guardada del usuario. Si aún no tiene,
  // migra el modo de la versión anterior o usa la predeterminada (no hereda la del
  // último usuario del navegador). Solo depende del id: las elecciones posteriores
  // ya están aplicadas localmente y no deben pisarse con un identity desactualizado.
  useEffect(() => {
    if (!user) return;
    let next: Pref;
    if (user.preferredPalette || user.preferredTheme) {
      next = {
        palette: user.preferredPalette ?? DEFAULT_PREF.palette,
        mode: user.preferredTheme ?? DEFAULT_PREF.mode,
      };
      takeLegacyMode();
    } else {
      const legacy = takeLegacyMode();
      next = legacy ? { ...DEFAULT_PREF, mode: legacy } : DEFAULT_PREF;
      if (legacy) void api.patch("/auth/profile", { preferredTheme: legacy }).catch(() => {});
    }
    setPref(next);
    writeLastPref(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const mq = darkQuery();
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = pref.mode === "system" ? (osDark ? "dark" : "light") : pref.mode;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.palette = pref.palette;
  }, [theme, pref.palette]);

  // Se aplica al instante; si falla el guardado en la BD solo se pierde para la
  // próxima sesión, así que no se revierte.
  const userId = user?.id;
  const update = useCallback(
    (patch: Partial<Pref>) => {
      setPref((cur) => {
        const next = { ...cur, ...patch };
        writeLastPref(next);
        return next;
      });
      if (!userId) return;
      const body: Record<string, string> = {};
      if (patch.palette) body.preferredPalette = patch.palette;
      if (patch.mode) body.preferredTheme = patch.mode;
      api.patch("/auth/profile", body).catch((err) => console.warn("[theme] No se pudo guardar la apariencia:", err));
    },
    [userId],
  );

  const setPalette = useCallback((palette: UiPalette) => update({ palette }), [update]);
  const setMode = useCallback((mode: UiMode) => update({ mode }), [update]);
  const toggle = useCallback(() => update({ mode: theme === "dark" ? "light" : "dark" }), [update, theme]);

  const value = useMemo<ThemeState>(
    () => ({ palette: pref.palette, mode: pref.mode, theme, setPalette, setMode, toggle }),
    [pref, theme, setPalette, setMode, toggle],
  );
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}
