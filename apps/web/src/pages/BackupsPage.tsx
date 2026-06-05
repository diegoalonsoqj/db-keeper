import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_PAGE_SIZE, type BackupJobDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useEnvironments, environmentLabel } from "../lib/environments";
import { useAuth } from "../auth/AuthContext";
import { Pagination } from "../components/Pagination";
import { BackupJobModal } from "../components/BackupJobModal";

export function BackupsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canManage = has("backups:schedule");
  const canRun = has("backups:run");
  const environments = useEnvironments();

  const [data, setData] = useState<Paginated<BackupJobDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [modal, setModal] = useState<{ job: BackupJobDto | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    setData(await api.get<Paginated<BackupJobDto>>(`/backups?limit=${page.limit}&offset=${page.offset}`));
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function run(job: BackupJobDto) {
    setError(null);
    setMsg(null);
    try {
      await api.post(`/backups/${job.id}/run`);
      setMsg(t("backups.runQueued", { name: job.name }));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  async function remove(job: BackupJobDto) {
    if (!confirm(t("common.confirm"))) return;
    try {
      await api.delete(`/backups/${job.id}`);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("backups.intro")}</p>
        {canManage && <button onClick={() => (setError(null), setModal({ job: null }))}>{t("backups.new")}</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="success">{msg}</p>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("backups.name")}</th>
              <th>{t("backups.server")}</th>
              <th>{t("backups.environment")}</th>
              <th>{t("backups.method")}</th>
              <th>{t("backups.databases")}</th>
              <th>{t("backups.bucket")}</th>
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
                <td>{j.method}</td>
                <td>{j.databases.length}</td>
                <td>{j.bucketName ?? t("common.none")}</td>
                <td>{j.isActive ? t("common.active") : t("common.inactive")}</td>
                <td className="row-actions">
                  {canRun && (
                    <button onClick={() => run(j)} disabled={!j.isActive}>
                      {t("backups.run")}
                    </button>
                  )}
                  {canManage && <button className="secondary" onClick={() => setModal({ job: j })}>{t("common.edit")}</button>}
                  {canManage && <button className="danger" onClick={() => remove(j)}>{t("common.delete")}</button>}
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
            reload().catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
          }}
        />
      )}
    </section>
  );
}
