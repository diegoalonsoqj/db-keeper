import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Pencil, Play, Trash2 } from "lucide-react";
import { BACKUP_METHODS, type BackupJobDto, type JobSort, type Paginated, type ServerDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useEnvironments, environmentLabel } from "../lib/environments";
import { useStorageTargets, defaultLocalTarget } from "../lib/storage";
import { METHOD_LABELS } from "../lib/backup-methods";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { Pagination } from "../components/Pagination";
import { ListToolbar } from "../components/ListToolbar";
import { SortTh } from "../components/SortTh";
import { useListParams } from "../lib/useListParams";
import { BackupJobModal } from "../components/BackupJobModal";
import { ScheduleModal } from "../components/ScheduleModal";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

export function BackupsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canManage = has("backups:schedule");
  const canRun = has("backups:run");
  const environments = useEnvironments();
  const targets = useStorageTargets();
  const localDefault = defaultLocalTarget(targets);
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<BackupJobDto>>({ items: [], total: 0 });
  const list = useListParams<"serverId" | "method" | "environment" | "scheduled" | "active", JobSort>({
    filters: ["serverId", "method", "environment", "scheduled", "active"],
    defaultSort: { key: "name", dir: "asc" },
  });
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [modal, setModal] = useState<{ job: BackupJobDto | null } | null>(null);
  const [scheduleJob, setScheduleJob] = useState<BackupJobDto | null>(null);

  async function reload() {
    setData(await api.get<Paginated<BackupJobDto>>(`/backups?${list.apiQuery}`));
  }
  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.apiQuery]);

  // Opciones del filtro de instancia (sin permiso de instancias, el filtro queda vacío).
  useEffect(() => {
    api
      .get<Paginated<ServerDto>>("/servers?limit=100")
      .then((r) => setServers(r.items))
      .catch(() => {});
  }, []);

  async function run(job: BackupJobDto) {
    try {
      await api.post(`/backups/${job.id}/run`);
      toast.success(t("backups.runQueued", { name: job.name }));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(job: BackupJobDto) {
    if (!(await confirm({ message: t("common.confirmDelete", { name: job.name }), danger: true }))) return;
    try {
      await api.delete(`/backups/${job.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("backups.intro")}</p>
        {canManage && <button onClick={() => setModal({ job: null })}>{t("backups.new")}</button>}
      </div>

      <ListToolbar
        search={list.q}
        onSearch={(q) => list.update({ q })}
        searchPlaceholder={t("backups.searchPlaceholder")}
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        <label>
          {t("backups.server")}
          <select value={list.filters.serverId} onChange={(e) => list.update({ serverId: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {servers.map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("backups.method")}
          <select value={list.filters.method} onChange={(e) => list.update({ method: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {BACKUP_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(METHOD_LABELS[m])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("backups.environment")}
          <select value={list.filters.environment} onChange={(e) => list.update({ environment: e.target.value })}>
            <option value="">{t("list.all")}</option>
            {environments.map((en) => (
              <option key={en.code} value={en.code}>
                {en.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("backups.scheduleFilter")}
          <select value={list.filters.scheduled} onChange={(e) => list.update({ scheduled: e.target.value })}>
            <option value="">{t("list.all")}</option>
            <option value="true">{t("backups.scheduled")}</option>
            <option value="false">{t("backups.manualOnly")}</option>
          </select>
        </label>
        <label>
          {t("backups.active")}
          <select value={list.filters.active} onChange={(e) => list.update({ active: e.target.value })}>
            <option value="">{t("list.all")}</option>
            <option value="true">{t("common.active")}</option>
            <option value="false">{t("common.inactive")}</option>
          </select>
        </label>
      </ListToolbar>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <SortTh sortKey="name" sort={list.sort} dir={list.sortDir} onSort={list.toggleSort}>{t("backups.name")}</SortTh>
              <SortTh sortKey="server" sort={list.sort} dir={list.sortDir} onSort={list.toggleSort}>{t("backups.server")}</SortTh>
              <SortTh sortKey="environment" sort={list.sort} dir={list.sortDir} onSort={list.toggleSort}>{t("backups.environment")}</SortTh>
              <SortTh sortKey="method" sort={list.sort} dir={list.sortDir} onSort={list.toggleSort}>{t("backups.method")}</SortTh>
              <th>{t("backups.databases")}</th>
              <SortTh sortKey="destination" sort={list.sort} dir={list.sortDir} onSort={list.toggleSort}>{t("backups.destination")}</SortTh>
              <SortTh sortKey="active" sort={list.sort} dir={list.sortDir} onSort={list.toggleSort}>{t("backups.active")}</SortTh>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  {list.hasFilters ? t("list.noResults") : t("list.empty")}
                </td>
              </tr>
            )}
            {data.items.map((j) => (
              <tr key={j.id}>
                <td>{j.name}</td>
                <td>{j.serverName}</td>
                <td>{environmentLabel(environments, j.environment) ?? t("common.none")}</td>
                <td>{t(METHOD_LABELS[j.method])}</td>
                <td>{j.databases.length}</td>
                <td>
                  {j.method !== "dump"
                    ? (j.bucketName ?? t("backups.bucketNone"))
                    : (localDefault?.name ?? t("storage.type_local"))}
                </td>
                <td>{j.isActive ? t("common.active") : t("common.inactive")}</td>
                <td className="row-actions">
                  {canRun && (
                    <button
                      className="icon-btn primary"
                      title={t("backups.run")}
                      aria-label={t("backups.run")}
                      onClick={() => run(j)}
                      disabled={!j.isActive}
                    >
                      <Play size={16} />
                    </button>
                  )}
                  {canManage && (
                    <button
                      className="icon-btn"
                      title={t("schedule.title")}
                      aria-label={t("schedule.title")}
                      onClick={() => setScheduleJob(j)}
                    >
                      <CalendarClock size={16} />
                    </button>
                  )}
                  {canManage && (
                    <button
                      className="icon-btn"
                      title={t("common.edit")}
                      aria-label={t("common.edit")}
                      onClick={() => setModal({ job: j })}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {canManage && (
                    <button
                      className="icon-btn danger"
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                      onClick={() => remove(j)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />

      {modal && (
        <BackupJobModal
          job={modal.job}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            toast.success(t("common.saved"));
            reload().catch((e) => toast.error(errMsg(e)));
          }}
        />
      )}

      {scheduleJob && (
        <ScheduleModal
          jobId={scheduleJob.id}
          jobName={scheduleJob.name}
          onClose={() => setScheduleJob(null)}
          onSaved={() => toast.success(t("schedule.saved", { name: scheduleJob.name }))}
        />
      )}
    </section>
  );
}
