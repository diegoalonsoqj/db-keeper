import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DayPicker, type DateRange } from "react-day-picker";
import { enUS, es } from "react-day-picker/locale";
import "react-day-picker/style.css";
import { DATE_PRESETS, presetRange } from "../lib/date-range";

interface Props {
  from?: Date;
  to?: Date;
  alignRight: boolean;
  maxHeight?: number;
  onApply: (range: { from?: Date; to?: Date }) => void;
  onCancel: () => void;
}

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

/** Con poco ancho se muestra un solo mes. */
function useMonths(): number {
  const query = "(max-width: 720px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (): void => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow ? 1 : 2;
}

/**
 * Calendario de rango: el primer clic marca el inicio y el segundo el fin (en
 * cualquier orden; dos clics en el mismo día = solo ese día). Los atajos aplican al
 * instante. Se carga diferido desde DateRangeFilter.
 */
export default function DateRangePopover({ from, to, alignRight, maxHeight, onApply, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const months = useMonths();
  const [draft, setDraft] = useState<DateRange | undefined>(from ? { from, to: to ?? from } : undefined);
  // Primer clic del rango en curso (null = el próximo clic empieza un rango nuevo).
  const [anchor, setAnchor] = useState<Date | null>(null);
  const today = new Date();

  const pick = (day: Date): void => {
    if (!anchor) {
      setAnchor(day);
      setDraft({ from: day, to: day });
      return;
    }
    setDraft(day < anchor ? { from: day, to: anchor } : { from: anchor, to: day });
    setAnchor(null);
  };

  const fmt = (d: Date): string => d.toLocaleDateString(i18n.language, { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <div
      className={`date-range-popover${alignRight ? " right" : ""}`}
      style={{ maxHeight }}
      role="dialog"
      aria-label={t("dateRange.title")}
    >
      <div className="date-range-presets">
        {DATE_PRESETS.map((p) => (
          <button key={p} type="button" className="secondary" onClick={() => onApply(presetRange(p))}>
            {t(`dateRange.preset_${p}`)}
          </button>
        ))}
      </div>
      <div className="date-range-calendar">
        <DayPicker
          mode="range"
          selected={draft}
          onSelect={(_range, day) => pick(day)}
          numberOfMonths={months}
          defaultMonth={draft?.from ?? new Date(today.getFullYear(), today.getMonth() - (months - 1), 1)}
          locale={i18n.language.startsWith("en") ? enUS : es}
          disabled={{ after: today }}
          showOutsideDays
        />
        <div className="date-range-footer">
          <span className="muted">
            {anchor ? t("dateRange.pickEnd") : draft?.from && draft.to && !sameDay(draft.from, draft.to)
              ? `${fmt(draft.from)} – ${fmt(draft.to)}`
              : draft?.from
                ? fmt(draft.from)
                : t("dateRange.pickStart")}
          </span>
          <div className="date-range-actions">
            {anchor && (
              <button type="button" className="secondary" onClick={() => onApply({ from: anchor })}>
                {t("dateRange.sinceButton", { date: fmt(anchor) })}
              </button>
            )}
            <button type="button" className="secondary" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button type="button" disabled={!draft?.from} onClick={() => onApply({ from: draft?.from, to: draft?.to })}>
              {t("dateRange.apply")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
