import { useTranslation } from "react-i18next";
import { PAGE_SIZES } from "@dbkeeper/shared";

interface Props {
  total: number;
  limit: number;
  offset: number;
  onChange: (next: { limit: number; offset: number }) => void;
}

/** Controles de paginación server-side: tamaño de página + navegación. */
export function Pagination({ total, limit, offset, onChange }: Props) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div className="pagination">
      <label className="pagination-size">
        {t("pagination.perPage")}
        <select
          value={limit}
          onChange={(e) => onChange({ limit: Number(e.target.value), offset: 0 })}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <span className="pagination-range">{t("pagination.range", { from, to, total })}</span>
      <div className="pagination-nav">
        <button
          className="secondary"
          disabled={page <= 1}
          onClick={() => onChange({ limit, offset: Math.max(0, offset - limit) })}
        >
          {t("pagination.prev")}
        </button>
        <button
          className="secondary"
          disabled={page >= totalPages}
          onClick={() => onChange({ limit, offset: offset + limit })}
        >
          {t("pagination.next")}
        </button>
      </div>
    </div>
  );
}
