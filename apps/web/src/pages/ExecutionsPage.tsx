import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_PAGE_SIZE, type ExecutionDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Pagination } from "../components/Pagination";

/** Refresco mientras haya corridas en curso, para ver el avance del motor (ms). */
const POLL_MS = 3000;
const COLS = 10;

export function ExecutionsPage() {
  const { t, i18n } = useTranslation();
  const { has } = useAuth();
  const canRun = has("backups:run");
  const [data, setData] = useState<Paginated<ExecutionDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function retry(e: ExecutionDto) {
    setError(null);
    setMsg(null);
    try {
      await api.post(`/backups/executions/${e.id}/retry`);
      setMsg(t("executions.retried", { name: e.label }));
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    }
  }

  async function download(execId: string, itemId: string, name: string) {
    setError(null);
    try {
      await api.download(`/backups/executions/${execId}/items/${itemId}/download`, name);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    }
  }

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
      {msg && <p className="success">{msg}</p>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("executions.event")}</th>
              <th>{t("executions.status")}</th>
              <th>{t("executions.origin")}</th>
              <th>{t("executions.environment")}</th>
              <th>{t("executions.databases")}</th>
              <th>{t("executions.created")}</th>
              <th>{t("executions.finished")}</th>
              <th>{t("executions.duration")}</th>
              <th>{t("executions.size")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={COLS} className="muted">
                  {t("executions.empty")}
                </td>
              </tr>
            )}
            {data.items.map((e) => (
              <Fragment key={e.id}>
                <tr>
                  <td>{e.label}</td>
                  <td>
                    <span className={`badge badge-${e.status}`}>{t(`status.${e.status}`)}</span>
                  </td>
                  <td>{t(`executions.origin_${e.origin}`)}</td>
                  <td>{e.environment ? <code>{e.environment}</code> : "—"}</td>
                  <td>{e.items.length}</td>
                  <td>{fmt(e.createdAt)}</td>
                  <td>{fmt(e.finishedAt)}</td>
                  <td>{fmtDuration(e.startedAt, e.finishedAt)}</td>
                  <td>{fmtBytes(totalBytes(e))}</td>
                  <td className="row-actions">
                    <button className="secondary" onClick={() => toggle(e.id)}>
                      {expanded.has(e.id) ? t("executions.hideDetail") : t("executions.detail")}
                    </button>
                    {canRun && e.status === "failed" && (
                      <button onClick={() => retry(e)}>{t("executions.retry")}</button>
                    )}
                  </td>
                </tr>
                {expanded.has(e.id) && (
                  <tr className="detail-row">
                    <td colSpan={COLS}>
                      <table className="grid sub">
                        <thead>
                          <tr>
                            <th>{t("executions.database")}</th>
                            <th>{t("executions.status")}</th>
                            <th>{t("executions.size")}</th>
                            <th>{t("executions.duration")}</th>
                            <th>{t("common.actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.items.map((it) => (
                            <Fragment key={it.id}>
                              <tr>
                                <td>{it.dbName}</td>
                                <td>
                                  <span className={`badge badge-${it.status}`}>
                                    {t(`status.${it.status}`)}
                                  </span>
                                </td>
                                <td>{fmtBytes(it.fileBytes)}</td>
                                <td>{fmtDuration(it.startedAt, it.finishedAt)}</td>
                                <td className="row-actions">
                                  {it.fileName && (
                                    <button
                                      className="secondary"
                                      onClick={() => download(e.id, it.id, it.dbName)}
                                    >
                                      {t("executions.download")}
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {it.log && (
                                <tr key={`${it.id}-log`}>
                                  <td colSpan={5}>
                                    <details>
                                      <summary className="muted">{t("executions.log")}</summary>
                                      <pre className="log">{it.log}</pre>
                                    </details>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={page.limit} offset={page.offset} onChange={setPage} />
    </section>
  );
}
