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

  /** Formatea bytes a B/KB/MB/GB. Devuelve «—» si no hay dato. */
  const fmtBytes = (n: number | null) => {
    if (n == null) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  /** Duración entre inicio y fin en formato compacto (s / m s / h m). */
  const fmtDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return "—";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 0) return "—";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} m ${s % 60} s`;
    return `${Math.floor(m / 60)} h ${m % 60} m`;
  };

  /** Suma de pesos de los ítems con archivo generado. */
  const totalBytes = (e: ExecutionDto) =>
    e.items.some((it) => it.fileBytes != null)
      ? e.items.reduce((acc, it) => acc + (it.fileBytes ?? 0), 0)
      : null;

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
              <th>{t("executions.finished")}</th>
              <th>{t("executions.duration")}</th>
              <th>{t("executions.size")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
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
                  {e.items
                    .map(
                      (it) =>
                        `${it.dbName} (${t(`status.${it.status}`)}` +
                        `${it.fileBytes != null ? `, ${fmtBytes(it.fileBytes)}` : ""})`,
                    )
                    .join(", ") || "—"}
                </td>
                <td>{fmt(e.createdAt)}</td>
                <td>{fmt(e.finishedAt)}</td>
                <td>{fmtDuration(e.startedAt, e.finishedAt)}</td>
                <td>{fmtBytes(totalBytes(e))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={page.limit} offset={page.offset} onChange={setPage} />
    </section>
  );
}
