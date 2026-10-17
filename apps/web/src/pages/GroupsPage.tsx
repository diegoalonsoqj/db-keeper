import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, CalendarClock, Pencil, Play, Trash2, X } from "lucide-react";
import {
  DEFAULT_PAGE_SIZE,
  GROUP_NOTIFY_MODES,
  type BackupJobDto,
  type GroupNotifyMode,
  type JobGroupDto,
  type Paginated,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { METHOD_LABELS } from "../lib/backup-methods";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";
import { ScheduleModal } from "../components/ScheduleModal";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

interface FormState {
  id: string | null;
  name: string;
  description: string;
  isActive: boolean;
  notifyStart: boolean;
  notifyMode: GroupNotifyMode;
  jobIds: string[];
}

const emptyForm: FormState = {
  id: null,
  name: "",
  description: "",
  isActive: true,
  notifyStart: false,
  notifyMode: "summary",
  jobIds: [],
};

/** Todos los eventos (la API pagina de a 100). */
async function fetchAllJobs(): Promise<BackupJobDto[]> {
  const all: BackupJobDto[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api.get<Paginated<BackupJobDto>>(`/backups?limit=100&offset=${offset}`);
    all.push(...page.items);
    if (all.length >= page.total || page.items.length === 0) return all;
  }
}

export function GroupsPage() {
  const { t, i18n } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("groups:write");
  const canRun = has("groups:run");
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<JobGroupDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);
  const [jobs, setJobs] = useState<BackupJobDto[]>([]);
  const [scheduleFor, setScheduleFor] = useState<JobGroupDto | null>(null);

  async function reload() {
    setData(await api.get<Paginated<JobGroupDto>>(`/groups?limit=${page.limit}&offset=${page.offset}`));
  }
  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function openForm(f: FormState) {
    try {
      setJobs(await fetchAllJobs());
      setForm(f);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function submit() {
    if (!form) return;
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        isActive: form.isActive,
        notifyStart: form.notifyStart,
        notifyMode: form.notifyMode,
        jobIds: form.jobIds,
      };
      if (form.id) await api.patch(`/groups/${form.id}`, body);
      else await api.post("/groups", body);
      setForm(null);
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(g: JobGroupDto) {
    if (!(await confirm({ message: t("groups.confirmDelete", { name: g.name }), danger: true }))) return;
    try {
      await api.delete(`/groups/${g.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function run(g: JobGroupDto) {
    if (!(await confirm({ message: t("groups.confirmRun", { name: g.name, count: g.members.length }) }))) return;
    try {
      const r = await api.post<{ executionIds: string[]; skipped: string[] }>(`/groups/${g.id}/run`);
      toast.success(t("groups.launched", { count: r.executionIds.length }));
      if (r.skipped.length > 0) toast.info(t("groups.skipped", { names: r.skipped.join(", ") }));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : "—");

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("groups.intro")}</p>
        {canWrite && <button onClick={() => openForm({ ...emptyForm })}>{t("groups.new")}</button>}
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("groups.name")}</th>
              <th>{t("groups.events")}</th>
              <th>{t("groups.nextRun")}</th>
              <th>{t("groups.active")}</th>
              {(canWrite || canRun) && <th>{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("groups.empty")}
                </td>
              </tr>
            )}
            {data.items.map((g) => (
              <tr key={g.id}>
                <td>
                  {g.name}
                  {g.description && (
                    <>
                      <br />
                      <small className="muted">{g.description}</small>
                    </>
                  )}
                </td>
                <td>
                  {g.members.length}
                  <br />
                  <small className="muted">{g.members.map((m) => m.jobName).join(", ")}</small>
                </td>
                <td>{fmt(g.nextRunAt)}</td>
                <td>{g.isActive ? t("common.active") : t("common.inactive")}</td>
                {(canWrite || canRun) && (
                  <td className="row-actions">
                    {canRun && (
                      <button className="icon-btn" title={t("groups.runNow")} aria-label={t("groups.runNow")} onClick={() => run(g)}>
                        <Play size={16} />
                      </button>
                    )}
                    {canWrite && (
                      <>
                        <button
                          className="icon-btn"
                          title={t("schedule.title")}
                          aria-label={t("schedule.title")}
                          onClick={() => setScheduleFor(g)}
                        >
                          <CalendarClock size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title={t("common.edit")}
                          aria-label={t("common.edit")}
                          onClick={() =>
                            openForm({
                              id: g.id,
                              name: g.name,
                              description: g.description ?? "",
                              isActive: g.isActive,
                              notifyStart: g.notifyStart,
                              notifyMode: g.notifyMode,
                              jobIds: g.members.map((m) => m.jobId),
                            })
                          }
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title={t("common.delete")}
                          aria-label={t("common.delete")}
                          onClick={() => remove(g)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={page.limit} offset={page.offset} onChange={setPage} />

      {form && (
        <GroupModal
          form={form}
          jobs={jobs}
          onChange={setForm}
          onClose={() => setForm(null)}
          onSubmit={submit}
        />
      )}

      {scheduleFor && (
        <ScheduleModal
          path={`/groups/${scheduleFor.id}`}
          name={scheduleFor.name}
          onClose={() => setScheduleFor(null)}
          onSaved={(saved) => {
            toast.success(t("schedule.saved", { name: scheduleFor.name }));
            if (saved?.warnings?.length) toast.info(t("groups.overlap", { names: saved.warnings.join(", ") }));
            void reload();
          }}
        />
      )}
    </section>
  );
}

function GroupModal({
  form,
  jobs,
  onChange,
  onClose,
  onSubmit,
}: {
  form: FormState;
  jobs: BackupJobDto[];
  onChange: (f: FormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const selected = form.jobIds.map((id) => byId.get(id)).filter((j): j is BackupJobDto => !!j);
  const available = jobs.filter((j) => !form.jobIds.includes(j.id));

  // Instancias con más de un evento en el grupo: la cola los serializa; mejor uno con todas sus BDs.
  const perServer = new Map<string, number>();
  for (const j of selected) perServer.set(j.serverName, (perServer.get(j.serverName) ?? 0) + 1);
  const repeated = [...perServer].filter(([, n]) => n > 1).map(([name]) => name);

  const move = (i: number, delta: number) => {
    const ids = [...form.jobIds];
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    onChange({ ...form, jobIds: ids });
  };

  return (
    <Modal
      title={form.id ? t("groups.edit") : t("groups.new")}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button onClick={onSubmit} disabled={!form.name.trim() || form.jobIds.length === 0}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <label>
        {t("groups.name")}
        <input value={form.name} maxLength={80} onChange={(e) => onChange({ ...form, name: e.target.value })} />
      </label>
      <label>
        {t("groups.description")}
        <input
          value={form.description}
          maxLength={255}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </label>
      <label className="inline">
        <input type="checkbox" checked={form.isActive} onChange={(e) => onChange({ ...form, isActive: e.target.checked })} />
        {t("groups.active")}
      </label>
      <small>{t("groups.activeHint")}</small>

      <fieldset>
        <legend>{t("groups.notifications")}</legend>
        <label>
          {t("groups.notifyMode")}
          <select
            value={form.notifyMode}
            onChange={(e) => onChange({ ...form, notifyMode: e.target.value as GroupNotifyMode })}
          >
            {GROUP_NOTIFY_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`groups.notifyModes.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <small className="muted">{t("groups.notifyModeHint")}</small>
        <label className="inline">
          <input
            type="checkbox"
            checked={form.notifyStart}
            onChange={(e) => onChange({ ...form, notifyStart: e.target.checked })}
          />
          {t("groups.notifyStart")}
        </label>
      </fieldset>

      <fieldset>
        <legend>{t("groups.events")}</legend>
        <small className="muted">{t("groups.orderHint")}</small>
        {selected.length === 0 ? (
          <p className="muted">{t("groups.noEvents")}</p>
        ) : (
          <table className="grid">
            <tbody>
              {selected.map((j, i) => (
                <tr key={j.id}>
                  <td>{i + 1}</td>
                  <td>
                    {j.name}
                    {!j.isActive && <span className="badge"> {t("common.inactive")}</span>}
                    <br />
                    <small className="muted">
                      {j.serverName} · {t(METHOD_LABELS[j.method])}
                    </small>
                  </td>
                  <td className="row-actions">
                    <button className="icon-btn" aria-label={t("groups.up")} title={t("groups.up")} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={t("groups.down")}
                      title={t("groups.down")}
                      disabled={i === selected.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label={t("groups.removeEvent")}
                      title={t("groups.removeEvent")}
                      onClick={() => onChange({ ...form, jobIds: form.jobIds.filter((id) => id !== j.id) })}
                    >
                      <X size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {repeated.length > 0 && <p className="muted">{t("groups.sameInstance", { names: repeated.join(", ") })}</p>}
        <label>
          {t("groups.addEvent")}
          <select
            value=""
            onChange={(e) => e.target.value && onChange({ ...form, jobIds: [...form.jobIds, e.target.value] })}
          >
            <option value="">{t("groups.pickEvent")}</option>
            {available.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} — {j.serverName}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
    </Modal>
  );
}
