import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UiMode } from "@dbkeeper/shared";
import { PALETTES, useTheme } from "../theme/ThemeContext";

const MODE_OPTIONS: { id: UiMode; label: string; icon: typeof Sun }[] = [
  { id: "dark", label: "settings.modeDark", icon: Moon },
  { id: "light", label: "settings.modeLight", icon: Sun },
  { id: "system", label: "settings.modeSystem", icon: Monitor },
];

const PALETTE_HINT = { cyan: "settings.paletteCyan", indigo: "settings.paletteIndigo", emerald: "settings.paletteEmerald" };

/** Configuración → Apariencia: paleta y modo del usuario (se aplican al instante). */
export function AppearanceCard({ hidden }: { hidden?: boolean }) {
  const { t } = useTranslation();
  const { palette, mode, theme, setPalette, setMode } = useTheme();

  return (
    <div className="card form-card" hidden={hidden}>
      <h2>{t("settings.appearance")}</h2>
      <p className="muted">{t("settings.appearanceHint")}</p>

      <fieldset className="appearance-field">
        <legend>{t("settings.palette")}</legend>
        <div className="palette-grid">
          {PALETTES.map((p) => {
            const [bg, panel, accent] = p.swatch[theme];
            const active = p.id === palette;
            return (
              <button
                key={p.id}
                type="button"
                className={`palette-option${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => setPalette(p.id)}
              >
                {/* Mini vista previa: fondo, panel y acento de la paleta en el modo actual. */}
                <span className="palette-preview" style={{ background: bg }}>
                  <span className="palette-preview-side" style={{ background: panel }} />
                  <span className="palette-preview-main" style={{ background: panel }}>
                    <span style={{ background: accent, width: "66%" }} />
                    <span style={{ background: accent, width: "33%", opacity: 0.4 }} />
                  </span>
                </span>
                <span className="palette-meta">
                  <span>
                    <strong>{p.label}</strong>
                    <small className="muted">{t(PALETTE_HINT[p.id])}</small>
                  </span>
                  {active && <Check size={15} aria-hidden />}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="appearance-field">
        <legend>{t("settings.mode")}</legend>
        <div className="mode-group">
          {MODE_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`mode-option${mode === id ? " active" : ""}`}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              <Icon size={14} aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
