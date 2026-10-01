import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Pencil, Play, Trash2 } from "lucide-react";
import { DEFAULT_PAGE_SIZE, type BackupJobDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useEnvironments, environmentLabel } from "../lib/environments";
import { useStorageTargets, defaultLocalTarget } from "../lib/storage";
import { METHOD_LABELS } from "../lib/backup-methods";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { Pagination } from "../components/Pagination";
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
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [modal, setModal] = useState<{ job: BackupJobDto | null } | null>(null);
  const [scheduleJob, setScheduleJob] = useState<BackupJobDto | null>(null);

  async function reload() {
    setData(await api.get<Paginated<BackupJobDto>>(`/backups?limit=${page.limit}&offset=${page.offset}`));
  }
  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("backups.name")}</th>
              <th>{t("backups.server")}</th>
              <th>{t("backups.environment")}</th>
              <th>{t("backups.method")}</th>
              <th>{t("backups.databases")}</th>
              <th>{t("backups.destination")}</th>
              <th>{t("backups.active")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
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
      <Pagination total={data.total} limit={page.limit} offset={page.offset} onChange={setPage} />

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
