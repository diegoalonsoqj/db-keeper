import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Copy, Download, History } from "lucide-react";
import {
  ARTIFACT_KINDS,
  ARTIFACT_LOCATIONS,
  ARTIFACT_STATES,
  DB_ENGINES,
  executionCode,
  type ArtifactSort,
  type BackupArtifactDto,
  type Paginated,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { Pagination } from "../components/Pagination";
import { ListToolbar } from "../components/ListToolbar";
import { SortTh } from "../components/SortTh";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { useListParams } from "../lib/useListParams";
import { useEnvironments, environmentLabel } from "../lib/environments";
import { fmtBytes } from "../lib/format";
import { ArtifactScanPanel } from "../components/ArtifactScanPanel";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));
const COLS = 10;

const VIEWS = ["catalog", "scan"] as const;
type View = (typeof VIEWS)[number];

/** Archivos de backup en disco local: catálogo y conciliación con el disco (solo lectura). */
export function ArtifactsPage() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const view: View = sp.get("view") === "scan" ? "scan" : "catalog";
  return (
    <>
      <div className="tabs" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={view === v ? "active" : ""}
            // Cada vista tiene sus propios filtros: al cambiar se descartan los de la otra.
            onClick={() => setSp(v === "catalog" ? {} : { view: v }, { replace: true })}
          >
            {t(`artifacts.view_${v}`)}
          </button>
        ))}
      </div>
      {view === "scan" ? <ArtifactScanPanel /> : <CatalogView />}
    </>
  );
}

function CatalogView() {
  const { t, i18n } = useTranslation();
  const { has } = useAuth();
  const canDownload = has("backups:download");
  const toast = useToast();
  const environments = useEnvironments();
  const [data, setData] = useState<Paginated<BackupArtifactDto>>({ items: [], total: 0 });
  const [hosts, setHosts] = useState<string[]>([]);
  const list = useListParams<"kind" | "location" | "state" | "environment" | "engine" | "runnerHost" | "from" | "to", ArtifactSort>({
    filters: ["kind", "location", "state", "environment", "engine", "runnerHost", "from", "to"],
    dateFilters: ["from", "to"],
    defaultSort: { key: "finished", dir: "desc" },
  });

  useEffect(() => {
    api
      .get<Paginated<BackupArtifactDto>>(`/artifacts?${list.apiQuery}`)
      .then(setData)
      .catch((e) => toast.error(errMsg(e)));
  }, [list.apiQuery, toast]);

  useEffect(() => {
    api.get<string[]>("/artifacts/hosts").then(setHosts).catch(() => {});
  }, []);

  async function download(a: BackupArtifactDto) {
    try {
      const what = a.kind === "log" ? "log" : "download";
      await api.download(`/backups/executions/${a.executionId}/items/${a.itemId}/${what}`, a.kind === "log" ? `${a.dbName}.log` : a.dbName);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  function copySha(sha: string) {
    navigator.clipboard
      .writeText(sha)
      .then(() => toast.success(t("executions.checksumCopied")))
      .catch((err) => toast.error(errMsg(err)));
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : "—");
  const sth = { sort: list.sort, dir: list.sortDir, onSort: list.toggleSort };

  return (
    <section>
      <ListToolbar
        search={list.q}
        onSearch={(q) => list.update({ q })}
        searchPlaceholder={t("artifacts.searchPlaceholder")}
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        <DateRangeFilter label={t("dateRange.label")} from={list.filters.from} to={list.filters.to} onChange={(r) => list.update(r)} />
        <label>
          {t("artifacts.state")}
          <select value={list.filters.state} onChange={(e) => list.update({ state: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {ARTIFACT_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`artifacts.state_${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("artifacts.location")}
          <select value={list.filters.location} onChange={(e) => list.update({ location: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {ARTIFACT_LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {t(`artifacts.location_${l}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("artifacts.kind")}
          <select value={list.filters.kind} onChange={(e) => list.update({ kind: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {ARTIFACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`artifacts.kind_${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("servers.engine")}
          <select value={list.filters.engine} onChange={(e) => list.update({ engine: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {DB_ENGINES.map((en) => (
              <option key={en} value={en}>
                {en}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("executions.environment")}
          <select value={list.filters.environment} onChange={(e) => list.update({ environment: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {environments.map((en) => (
              <option key={en.code} value={en.code}>
                {en.name}
              </option>
            ))}
          </select>
        </label>
        {hosts.length > 1 && (
          <label>
            {t("artifacts.host")}
            <select value={list.filters.runnerHost} onChange={(e) => list.update({ runnerHost: e.target.value })}>
              <option value="">{t("list.all")}</option>
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
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
              <SortTh sortKey="finished" firstDir="desc" {...sth}>
                {t("artifacts.date")}
              </SortTh>
              <SortTh sortKey="label" {...sth}>
                {t("executions.event")}
              </SortTh>
              <SortTh sortKey="database" {...sth}>
                {t("artifacts.database")}
              </SortTh>
              <th>{t("servers.engine")}</th>
              <SortTh sortKey="environment" {...sth}>
                {t("executions.environment")}
              </SortTh>
              <th>{t("artifacts.location")}</th>
              <th>{t("artifacts.host")}</th>
              <SortTh sortKey="size" firstDir="desc" {...sth}>
                {t("artifacts.size")}
              </SortTh>
              <th>{t("artifacts.state")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={COLS} className="muted">
                  {list.hasFilters ? t("list.noResults") : t("artifacts.empty")}
                </td>
              </tr>
            )}
            {data.items.map((a) => (
              <tr key={`${a.itemId}:${a.kind}`}>
                <td>{fmt(a.finishedAt)}</td>
                <td>{a.label}</td>
                <td>{a.dbName}</td>
                <td>{a.engine ?? "—"}</td>
                <td>{environmentLabel(environments, a.environment) ?? "—"}</td>
                <td>
                  {a.storageName && <span className="muted">{a.storageName} · </span>}
                  <code>{a.relativePath}</code>
                  {a.kind !== "file" && (
                    <span className="badge" title={t(`artifacts.kind_${a.kind}_hint`)}>
                      {t(`artifacts.kind_${a.kind}`)}
                    </span>
                  )}
                </td>
                <td>{a.runnerHost ?? "—"}</td>
                <td>{fmtBytes(a.fileBytes)}</td>
                <td>
                  {a.prunedAt ? (
                    <span className="badge" title={fmt(a.prunedAt)}>
                      {t("artifacts.state_pruned")}
                    </span>
                  ) : (
                    <span className="badge badge-success">{t("artifacts.state_available")}</span>
                  )}
                </td>
                <td className="row-actions">
                  <Link
                    className="icon-btn"
                    to={`/executions?q=${encodeURIComponent(`#${executionCode(a.executionId)}`)}`}
                    title={t("artifacts.viewExecution")}
                    aria-label={t("artifacts.viewExecution")}
                  >
                    <History size={16} />
                  </Link>
                  {a.checksums?.sha256 && (
                    <button
                      className="icon-btn"
                      title={t("artifacts.copySha")}
                      aria-label={t("artifacts.copySha")}
                      onClick={() => copySha(a.checksums!.sha256!)}
                    >
                      <Copy size={16} />
                    </button>
                  )}
                  {/*
                    La descarga sirve el archivo del evento: en una copia sería el objeto del
                    bucket (se descarga desde su fila). Las carpetas no se descargan desde la web.
                  */}
                  {canDownload && !a.prunedAt && a.kind !== "copy" && !a.relativePath.endsWith("/") && (
                    <button
                      className="icon-btn"
                      title={t("executions.download")}
                      aria-label={t("executions.download")}
                      onClick={() => download(a)}
                    >
                      <Download size={16} />
                    </button>
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
