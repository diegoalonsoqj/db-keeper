import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Download, FileText, RotateCcw } from "lucide-react";
import { DEFAULT_PAGE_SIZE, type ExecutionDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useExecutionStream } from "../lib/useExecutionStream";
import { Modal } from "../components/Modal";
import { useEnvironments, environmentLabel } from "../lib/environments";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));
import { Pagination } from "../components/Pagination";

/** Modal con el log de una BD: streamea en vivo mientras corre y hace auto-scroll. */
function LogModal({
  dbName,
  text,
  running,
  onClose,
}: {
  dbName: string;
  text: string;
  running: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight; // seguir el final al llegar líneas
  }, [text]);
  return (
    <Modal
      title={`${t("executions.log")} — ${dbName}`}
      size="lg"
      onClose={onClose}
      footer={
        <button className="secondary" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      {running && <p className="muted">{t("executions.liveConsole")}…</p>}
      <pre className="log log-modal" ref={preRef}>
        {text || "—"}
      </pre>
    </Modal>
  );
}

/** Refresco mientras haya corridas en curso, para ver el avance del motor (ms). */
const POLL_MS = 3000;
const COLS = 10;

export function ExecutionsPage() {
  const { t, i18n } = useTranslation();
  const { has } = useAuth();
  const canRun = has("backups:run");
  const environments = useEnvironments();
  const toast = useToast();
  const [data, setData] = useState<Paginated<ExecutionDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Si el stream SSE está conectado, no hace falta sondear; si cae, se reactiva.
  const [streamOn, setStreamOn] = useState(false);
  // Consola en vivo por BD (clave `execId::dbName`), efímera (no persiste al recargar).
  const [liveLogs, setLiveLogs] = useState<Record<string, string[]>>({});
  // Progreso en vivo por BD (bytes del dump en curso), efímero.
  const [liveProgress, setLiveProgress] = useState<Record<string, number>>({});
  // Reloj para el cronómetro en vivo de las corridas en curso.
  const [now, setNow] = useState(Date.now());
  // Log abierto en modal (se resuelve el ítem/líneas en cada render → siempre al día).
  const [logFor, setLogFor] = useState<{ execId: string; dbName: string } | null>(null);

  const load = useCallback(() => {
    return api
      .get<Paginated<ExecutionDto>>(`/backups/executions?limit=${page.limit}&offset=${page.offset}`)
      .then(setData)
      .catch((e) => toast.error(errMsg(e)));
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Progreso en vivo por SSE: reemplaza el snapshot de la ejecución que cambió.
  const itemsRef = useRef(data.items);
  itemsRef.current = data.items;
  const onEvent = useCallback(
    (execution: ExecutionDto) => {
      const exists = itemsRef.current.some((e) => e.id === execution.id);
      if (!exists) {
        // Ejecución nueva (p. ej. recién lanzada): refrescar la primera página.
        if (page.offset === 0) void load();
        return;
      }
      setData((prev) => ({
        ...prev,
        items: prev.items.map((e) => (e.id === execution.id ? execution : e)),
      }));
    },
    [load, page.offset],
  );
  const onLog = useCallback(({ executionId, dbName, lines }: { executionId: string; dbName: string; lines: string[] }) => {
    const key = `${executionId}::${dbName}`;
    setLiveLogs((prev) => {
      const next = (prev[key] ?? []).concat(lines);
      return { ...prev, [key]: next.length > 500 ? next.slice(-500) : next };
    });
  }, []);
  const onProgress = useCallback(({ executionId, dbName, bytes }: { executionId: string; dbName: string; bytes: number }) => {
    setLiveProgress((prev) => ({ ...prev, [`${executionId}::${dbName}`]: bytes }));
  }, []);
  useExecutionStream({
    onEvent,
    onLog,
    onProgress,
    onStatus: (connected) => {
      setStreamOn(connected);
      if (connected) void load(); // resync al (re)conectar (cubre eventos perdidos)
    },
  });

  // Fallback: si el SSE no está conectado y hay corridas en curso, sondear.
  const isActive = data.items.some((e) => e.status === "pending" || e.status === "running");
  useEffect(() => {
    if (streamOn || !isActive) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [streamOn, isActive, load]);

  // Cronómetro en vivo: refresca cada segundo mientras haya corridas en curso.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function retry(e: ExecutionDto) {
    try {
      await api.post(`/backups/executions/${e.id}/retry`);
      toast.success(t("executions.retried", { name: e.label }));
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function download(execId: string, itemId: string, name: string) {
    try {
      await api.download(`/backups/executions/${execId}/items/${itemId}/download`, name);
    } catch (err) {
      toast.error(errMsg(err));
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

  /** Formatea milisegundos en formato compacto (s / m s / h m). */
  const fmtMs = (ms: number) => {
    if (ms < 0) return "—";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} m ${s % 60} s`;
    return `${Math.floor(m / 60)} h ${m % 60} m`;
  };

  /** Duración entre inicio y fin en formato compacto. */
  const fmtDuration = (start: string | null, end: string | null) =>
    start && end ? fmtMs(new Date(end).getTime() - new Date(start).getTime()) : "—";

  /** Duración mostrada: en vivo (desde el inicio hasta ahora) mientras corre. */
  const liveDuration = (status: ExecutionDto["status"], start: string | null, end: string | null) =>
    status === "running" && start ? fmtMs(now - new Date(start).getTime()) : fmtDuration(start, end);

  /** Suma de pesos de los ítems con archivo generado. */
  const totalBytes = (e: ExecutionDto) =>
    e.items.some((it) => it.fileBytes != null)
      ? e.items.reduce((acc, it) => acc + (it.fileBytes ?? 0), 0)
      : null;

  /** Peso del ítem: en vivo (tamaño del dump en curso) mientras corre. */
  const itemSize = (e: ExecutionDto, it: ExecutionDto["items"][number]) => {
    const live = liveProgress[`${e.id}::${it.dbName}`];
    if (it.status === "running" && live != null) return `${fmtBytes(live)} …`;
    return fmtBytes(it.fileBytes);
  };

  /** Peso de la ejecución: suma en vivo de los dumps en curso mientras corre. */
  const execSize = (e: ExecutionDto) => {
    if (e.status === "running") {
      const live = e.items
        .filter((it) => it.status === "running")
        .map((it) => liveProgress[`${e.id}::${it.dbName}`])
        .filter((b): b is number => b != null);
      const done = e.items.reduce((acc, it) => acc + (it.fileBytes ?? 0), 0);
      const sum = done + live.reduce((a, b) => a + b, 0);
      if (live.length > 0 || done > 0) return `${fmtBytes(sum)} …`;
    }
    return fmtBytes(totalBytes(e));
  };

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("executions.intro")}</p>
      </div>

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
                  <td>{environmentLabel(environments, e.environment) ?? "—"}</td>
                  <td>{e.items.length}</td>
                  <td>{fmt(e.createdAt)}</td>
                  <td>{fmt(e.finishedAt)}</td>
                  <td>{liveDuration(e.status, e.startedAt, e.finishedAt)}</td>
                  <td>{execSize(e)}</td>
                  <td className="row-actions">
                    <button
                      className="icon-btn"
                      title={expanded.has(e.id) ? t("executions.hideDetail") : t("executions.detail")}
                      aria-label={expanded.has(e.id) ? t("executions.hideDetail") : t("executions.detail")}
                      onClick={() => toggle(e.id)}
                    >
                      {expanded.has(e.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    {canRun && e.status === "failed" && (
                      <button
                        className="icon-btn primary"
                        title={t("executions.retry")}
                        aria-label={t("executions.retry")}
                        onClick={() => retry(e)}
                      >
                        <RotateCcw size={16} />
                      </button>
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
                                <td>{itemSize(e, it)}</td>
                                <td>{liveDuration(it.status, it.startedAt, it.finishedAt)}</td>
                                <td className="row-actions">
                                  {(it.log || liveLogs[`${e.id}::${it.dbName}`]) && (
                                    <button
                                      className="icon-btn"
                                      title={t("executions.log")}
                                      aria-label={t("executions.log")}
                                      onClick={() => setLogFor({ execId: e.id, dbName: it.dbName })}
                                    >
                                      <FileText size={16} />
                                    </button>
                                  )}
                                  {it.prunedAt ? (
                                    <span className="muted" title={fmt(it.prunedAt)}>
                                      {t("executions.pruned")}
                                    </span>
                                  ) : (
                                    it.fileName && (
                                      <button
                                        className="icon-btn"
                                        title={t("executions.download")}
                                        aria-label={t("executions.download")}
                                        onClick={() => download(e.id, it.id, it.dbName)}
                                      >
                                        <Download size={16} />
                                      </button>
                                    )
                                  )}
                                </td>
                              </tr>
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

      {logFor &&
        (() => {
          const exec = data.items.find((e) => e.id === logFor.execId);
          const item = exec?.items.find((i) => i.dbName === logFor.dbName);
          if (!item) return null;
          const live = liveLogs[`${logFor.execId}::${logFor.dbName}`];
          const text = item.log ?? (live ? live.join("\n") : "");
          return (
            <LogModal
              dbName={item.dbName}
              text={text}
              running={item.status === "running"}
              onClose={() => setLogFor(null)}
            />
          );
        })()}
    </section>
  );
}
