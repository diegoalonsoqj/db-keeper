import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, X } from "lucide-react";
import { formatDay, parseDay } from "../lib/date-range";

// El calendario (react-day-picker + date-fns) solo se descarga al abrirlo.
const DateRangePopover = lazy(() => import("./DateRangePopover"));

interface Props {
  label: string;
  /** Rango aplicado como `YYYY-MM-DD` (vacío = sin límite). */
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}

/**
 * Filtro de fechas en un solo campo: abre un calendario donde se marca inicio y fin
 * (o un atajo: hoy, últimos 7/30 días, este mes, mes anterior).
 */
export function DateRangeFilter({ label, from, to, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  // Alto disponible bajo el campo: el calendario hace scroll interno si no cabe.
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Cerrar con clic fuera o Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    // Si el campo está en la mitad derecha, el calendario se abre hacia la izquierda.
    setAlignRight(Boolean(rect && rect.left > window.innerWidth / 2));
    setMaxHeight(rect ? Math.max(240, window.innerHeight - rect.bottom - 16) : undefined);
    setOpen((o) => !o);
  };

  const fmt = (v: string): string => {
    const d = parseDay(v);
    return d ? d.toLocaleDateString(i18n.language, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  };
  const text =
    from && to
      ? from === to
        ? fmt(from)
        : `${fmt(from)} – ${fmt(to)}`
      : from
        ? t("dateRange.since", { date: fmt(from) })
        : to
          ? t("dateRange.until", { date: fmt(to) })
          : t("dateRange.any");

  return (
    <div className="date-range" ref={wrapRef}>
      <span className="date-range-label">{label}</span>
      <div className="date-range-field">
        <button
          type="button"
          className={`date-range-trigger${from || to ? " has-value" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <CalendarDays size={15} aria-hidden="true" />
          <span>{text}</span>
        </button>
        {(from || to) && (
          <button
            type="button"
            className="date-range-clear"
            title={t("dateRange.clear")}
            aria-label={t("dateRange.clear")}
            onClick={() => onChange({ from: "", to: "" })}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <Suspense fallback={<div className={`date-range-popover${alignRight ? " right" : ""}`}>{t("common.loading")}</div>}>
          <DateRangePopover
            from={parseDay(from)}
            to={parseDay(to)}
            alignRight={alignRight}
            maxHeight={maxHeight}
            onApply={(r) => {
              onChange({ from: r.from ? formatDay(r.from) : "", to: r.to ? formatDay(r.to) : "" });
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
