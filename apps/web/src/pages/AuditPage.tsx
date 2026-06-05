import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_PAGE_SIZE, type AuditEntryDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { Pagination } from "../components/Pagination";

const EMPTY_FILTERS = { from: "", to: "", action: "", entityType: "", username: "" };

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Paginated<AuditEntryDto>>({ items: [], total: 0 });
  const [filters, setFilters] = useState(EMPTY_FILTERS); // borrador (inputs)
  const [applied, setApplied] = useState(EMPTY_FILTERS); // filtros en uso
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
    for (const [k, v] of Object.entries(applied)) if (v) qs.set(k, v);
    api
      .get<Paginated<AuditEntryDto>>(`/audit?${qs.toString()}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, [applied, page]);

  function apply() {
    setApplied(filters);
    setPage((p) => ({ ...p, offset: 0 }));
  }
  function clear() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage((p) => ({ ...p, offset: 0 }));
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) =>
    setFilters({ ...filters, [k]: e.target.value });

  return (
    <section>
      <div className="page-head">
        <h1>{t("audit.title")}</h1>
        <span className="muted">{data.total}</span>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="filters">
        <label>
          {t("audit.from")}
          <input type="date" value={filters.from} onChange={set("from")} />
        </label>
        <label>
          {t("audit.to")}
          <input type="date" value={filters.to} onChange={set("to")} />
        </label>
        <label>
          {t("audit.action")}
          <input value={filters.action} onChange={set("action")} placeholder="servers.create" />
        </label>
        <label>
          {t("audit.entity")}
          <input value={filters.entityType} onChange={set("entityType")} placeholder="server" />
        </label>
        <label>
          {t("audit.user")}
          <input value={filters.username} onChange={set("username")} />
        </label>
        <button onClick={apply}>{t("audit.apply")}</button>
        <button className="secondary" onClick={clear}>
          {t("audit.clear")}
        </button>
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("audit.when")}</th>
              <th>{t("audit.user")}</th>
              <th>{t("audit.action")}</th>
              <th>{t("audit.entity")}</th>
              <th>{t("audit.ip")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("audit.empty")}
                </td>
              </tr>
            )}
            {data.items.map((e) => (
              <tr key={e.id}>
                <td>{fmt(e.createdAt)}</td>
                <td>{e.username ?? "—"}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>{e.entityType ? `${e.entityType}${e.entityId ? `:${e.entityId.slice(0, 8)}` : ""}` : "—"}</td>
                <td>{e.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={page.limit} offset={page.offset} onChange={setPage} />
    </section>
  );
}
