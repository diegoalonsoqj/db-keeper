import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_PAGE_SIZE, type ExecutionDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { Pagination } from "../components/Pagination";

/** Refresco mientras haya corridas en curso, para ver el avance del motor (ms). */
const POLL_MS = 3000;

export function ExecutionsPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Paginated<ExecutionDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .get<Paginated<ExecutionDto>>(`/backups/executions?limit=${page.limit}&offset=${page.offset}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mientras alguna ejecución esté pendiente/en curso, refresca en intervalo.
  const isActive = data.items.some((e) => e.status === "pending" || e.status === "running");
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [isActive, load]);

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : "—");

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("executions.intro")}</p>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("executions.event")}</th>
              <th>{t("executions.status")}</th>
              <th>{t("executions.origin")}</th>
              <th>{t("executions.databases")}</th>
              <th>{t("executions.created")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("executions.empty")}
                </td>
              </tr>
            )}
            {data.items.map((e) => (
              <tr key={e.id}>
                <td>{e.label}</td>
                <td>
                  <span className={`badge badge-${e.status}`}>{t(`status.${e.status}`)}</span>
                </td>
                <td>{t(`executions.origin_${e.origin}`)}</td>
                <td>
                  {e.items.map((it) => `${it.dbName} (${t(`status.${it.status}`)})`).join(", ") || "—"}
                </td>
                <td>{fmt(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={page.limit} offset={page.offset} onChange={setPage} />
    </section>
  );
}
