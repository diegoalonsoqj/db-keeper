import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Cloud, HardDrive, History } from "lucide-react";
import {
  executionCode,
  SCAN_FINDING_KINDS,
  type ArtifactLocation,
  type Paginated,
  type ScanFindingDto,
  type StorageScanDto,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./Toast";
import { Pagination } from "./Pagination";
import { ListToolbar } from "./ListToolbar";
import { useListParams } from "../lib/useListParams";
import { fmtBytes } from "../lib/format";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));
const POLL_MS = 2000;
const COLS = 6;
const KIND_BADGE = { orphan: "badge-pending", missing: "badge-failed", stale: "badge-running" } as const;

/**
 * Conciliación del catálogo con el disco local: escaneo por host y sus hallazgos.
 * Solo muestra; nada se borra desde aquí.
 */
export function ArtifactScanPanel() {
  const { t, i18n } = useTranslation();
  const { has } = useAuth();
  const canScan = has("storage:manage");
  const toast = useToast();
  const [scans, setScans] = useState<StorageScanDto[]>([]);
  const [data, setData] = useState<Paginated<ScanFindingDto>>({ items: [], total: 0 });
  const [starting, setStarting] = useState(false);
  const list = useListParams<"kind" | "scope", "kind">({
    filters: ["kind", "scope"],
    defaultSort: { key: "kind", dir: "asc" },
  });

  const loadScans = useCallback(
    () =>
      api
        .get<StorageScanDto[]>("/artifacts/scans")
        .then(setScans)
        .catch((e) => toast.error(errMsg(e))),
    [toast],
  );

  useEffect(() => void loadScans(), [loadScans]);

  // Mientras algún host escanea, se consulta su estado hasta que termine.
  const running = scans.some((s) => s.status === "running");
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void loadScans(), POLL_MS);
    return () => clearInterval(id);
  }, [running, loadScans]);

  // Al terminar un escaneo cambia su id/fin: se recargan los hallazgos.
  const scanKey = scans.map((s) => `${s.id}:${s.status}`).join(",");
  useEffect(() => {
    api
      .get<Paginated<ScanFindingDto>>(`/artifacts/findings?${list.apiQuery}`)
      .then(setData)
      .catch((e) => toast.error(errMsg(e)));
  }, [list.apiQuery, scanKey, toast]);

  async function startScan(location: ArtifactLocation) {
    setStarting(true);
    try {
      setScans(await api.post<StorageScanDto[]>("/artifacts/scans", { location }));
      toast.success(t("artifacts.scanStarted"));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setStarting(false);
    }
  }

  /** Ámbito legible: el host (disco local) o «Buckets». */
  const scopeLabel = (location: ArtifactLocation, scope: string) =>
    location === "gcs" ? t("artifacts.location_gcs") : scope;
  const busy = (location: ArtifactLocation) => scans.some((s) => s.location === location && s.status === "running");

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : "—");

  return (
    <section>
      <div className="card">
        <div className="card-head">
          <h2>{t("artifacts.scanTitle")}</h2>
          {canScan && (
            <div className="row-actions">
              <button type="button" onClick={() => void startScan("local")} disabled={starting || busy("local")}>
                <HardDrive size={16} aria-hidden /> {busy("local") ? t("artifacts.scanRunning") : t("artifacts.scanNow")}
              </button>
              <button type="button" onClick={() => void startScan("gcs")} disabled={starting || busy("gcs")}>
                <Cloud size={16} aria-hidden /> {busy("gcs") ? t("artifacts.scanRunning") : t("artifacts.scanBuckets")}
              </button>
            </div>
          )}
        </div>
        <p className="muted">{t("artifacts.scanHelp")}</p>
        {scans.length === 0 ? (
          <p className="muted">{t("artifacts.scanNever")}</p>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{t("artifacts.scope")}</th>
                <th>{t("artifacts.state")}</th>
                <th>{t("artifacts.scanWhen")}</th>
                <th>{t("artifacts.scanFiles")}</th>
                {SCAN_FINDING_KINDS.map((k) => (
                  <th key={k}>{t(`artifacts.finding_${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => (
                <tr key={s.id}>
                  <td title={t("artifacts.scanRanOn", { host: s.runnerHost })}>{scopeLabel(s.location, s.scope)}</td>
                  <td>
                    <span className={`badge badge-${s.status === "done" ? "success" : s.status}`}>
                      {t(`artifacts.scanStatus_${s.status}`)}
                    </span>
                    {s.truncated && (
                      <span className="badge badge-pending" title={t("artifacts.scanTruncatedHint")}>
                        {t("artifacts.scanTruncated")}
                      </span>
                    )}
                    {s.error && <div className="muted">{s.error}</div>}
                    {s.roots && s.roots.missing.length > 0 && (
                      <div className="muted">{t("artifacts.scanRootsMissing", { names: s.roots.missing.join(", ") })}</div>
                    )}
                  </td>
                  <td title={s.startedBy ? t("artifacts.scanBy", { user: s.startedBy }) : undefined}>
                    {fmt(s.finishedAt ?? s.startedAt)}
                  </td>
                  <td>{s.status === "running" ? "…" : s.filesScanned}</td>
                  {SCAN_FINDING_KINDS.map((k) => (
                    <td key={k}>{s.status === "running" ? "…" : s.counts[k]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ListToolbar
        search={list.q}
        onSearch={(q) => list.update({ q })}
        searchPlaceholder={t("artifacts.findingSearch")}
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        <label>
          {t("artifacts.kind")}
          <select value={list.filters.kind} onChange={(e) => list.update({ kind: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {SCAN_FINDING_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`artifacts.finding_${k}`)}
              </option>
            ))}
          </select>
        </label>
        {scans.length > 1 && (
          <label>
            {t("artifacts.scope")}
            <select value={list.filters.scope} onChange={(e) => list.update({ scope: e.target.value })}>
              <option value="">{t("list.all")}</option>
              {scans.map((s) => (
                <option key={s.scope} value={s.scope}>
                  {scopeLabel(s.location, s.scope)}
                </option>
              ))}
            </select>
          </label>
        )}
      </ListToolbar>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("artifacts.kind")}</th>
              <th>{t("artifacts.scope")}</th>
              <th>{t("artifacts.location")}</th>
              <th>{t("artifacts.size")}</th>
              <th>{t("artifacts.modified")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={COLS} className="muted">
                  {list.hasFilters ? t("list.noResults") : t("artifacts.findingsEmpty")}
                </td>
              </tr>
            )}
            {data.items.map((f) => (
              <tr key={f.id}>
                <td>
                  <span className={`badge ${KIND_BADGE[f.kind]}`} title={t(`artifacts.finding_${f.kind}_hint`)}>
                    {t(`artifacts.finding_${f.kind}`)}
                  </span>
                </td>
                <td>{scopeLabel(f.location, f.scope)}</td>
                <td>
                  {f.storageName && <span className="muted">{f.storageName} · </span>}
                  <code>{f.relativePath}</code>
                </td>
                <td>{fmtBytes(f.fileBytes)}</td>
                <td>{fmt(f.modifiedAt)}</td>
                <td className="row-actions">
                  {f.executionId && (
                    <Link
                      className="icon-btn"
                      to={`/executions?q=${encodeURIComponent(`#${executionCode(f.executionId)}`)}`}
                      title={t("artifacts.viewExecution")}
                      aria-label={t("artifacts.viewExecution")}
                    >
                      <History size={16} />
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />
    </section>
  );
}
