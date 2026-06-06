import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import {
  DB_ENGINES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PORTS,
  type CredentialDto,
  type DbEngine,
  type EnvironmentDto,
  type Paginated,
  type ServerDto,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { environmentLabel } from "../lib/environments";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

interface FormState {
  id: string | null;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  environment: string;
  useSsl: boolean;
  isCloudSql: boolean;
  gcpProject: string;
  gcpInstance: string;
  notes: string;
  credentialId: string;
}

const emptyForm: FormState = {
  id: null,
  name: "",
  engine: "postgres",
  host: "",
  port: DEFAULT_PORTS.postgres,
  environment: "",
  useSsl: false,
  isCloudSql: false,
  gcpProject: "",
  gcpInstance: "",
  notes: "",
  credentialId: "",
};

export function ServersPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<ServerDto>>({ items: [], total: 0 });
  const [credentials, setCredentials] = useState<CredentialDto[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentDto[]>([]);
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);

  async function reload() {
    const [srv, creds, envs] = await Promise.all([
      api.get<Paginated<ServerDto>>(`/servers?limit=${page.limit}&offset=${page.offset}`),
      api.get<Paginated<CredentialDto>>("/credentials?limit=100"),
      api.get<Paginated<EnvironmentDto>>("/environments?limit=100"),
    ]);
    setData(srv);
    setCredentials(creds.items);
    setEnvironments(envs.items);
  }
  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function startEdit(s: ServerDto) {
    setForm({
      id: s.id,
      name: s.name,
      engine: s.engine,
      host: s.host,
      port: s.port,
      environment: s.environment ?? "",
      useSsl: s.useSsl,
      isCloudSql: s.isCloudSql,
      gcpProject: s.gcpProject ?? "",
      gcpInstance: s.gcpInstance ?? "",
      notes: s.notes ?? "",
      credentialId: s.credentialId ?? "",
    });
  }

  async function submit() {
    if (!form) return;
    try {
      const base = {
        name: form.name,
        engine: form.engine,
        host: form.host,
        port: Number(form.port),
        environment: form.environment || null,
        useSsl: form.useSsl,
        isCloudSql: form.isCloudSql,
        gcpProject: form.gcpProject || null,
        gcpInstance: form.gcpInstance || null,
        notes: form.notes || null,
        credentialId: form.credentialId || null,
      };
      if (form.id) await api.patch(`/servers/${form.id}`, base);
      else await api.post("/servers", base);
      setForm(null);
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(s: ServerDto) {
    if (!(await confirm({ message: t("common.confirmDelete", { name: s.name }), danger: true }))) return;
    try {
      await api.delete(`/servers/${s.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        {canWrite && <button onClick={() => setForm({ ...emptyForm })}>{t("servers.new")}</button>}
      </div>

      <div className="table-wrap">
        <table className="grid">
        <thead>
          <tr>
            <th>{t("servers.name")}</th>
            <th>{t("servers.engine")}</th>
            <th>{t("servers.host")}</th>
            <th>{t("servers.port")}</th>
            <th>{t("servers.environment")}</th>
            <th>{t("servers.credential")}</th>
            {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
          </tr>
        </thead>
        <tbody>
          {data.items.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.engine}{s.isCloudSql ? " · Cloud SQL" : ""}</td>
              <td>{s.host}{s.useSsl ? " 🔒" : ""}</td>
              <td>{s.port}</td>
              <td>{environmentLabel(environments, s.environment) ?? t("common.none")}</td>
              <td>{s.credentialName ?? t("common.none")}</td>
              {(canWrite || canDelete) && (
                <td className="row-actions">
                  {canWrite && (
                    <button className="icon-btn" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => startEdit(s)}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button className="icon-btn danger" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => remove(s)}>
                      <Trash2 size={16} />
                    </button>
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
        <Modal
          title={form.id ? t("common.edit") : t("servers.new")}
          onClose={() => setForm(null)}
          footer={
            <>
              <button className="secondary" onClick={() => setForm(null)}>
                {t("common.cancel")}
              </button>
              <button onClick={submit}>{t("common.save")}</button>
            </>
          }
        >
          <label>
            {t("servers.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t("servers.engine")}
            <select
              value={form.engine}
              onChange={(e) => {
                const engine = e.target.value as DbEngine;
                setForm({ ...form, engine, port: DEFAULT_PORTS[engine] });
              }}
            >
              {DB_ENGINES.map((eng) => (
                <option key={eng} value={eng}>
                  {eng}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("servers.host")}
            <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </label>
          <label>
            {t("servers.port")}
            <input
              type="number"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
            />
          </label>
          <label>
            {t("servers.environment")}
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value })}
            >
              <option value="">{t("servers.environmentNone")}</option>
              {/* Conserva el valor actual aunque el ambiente esté inactivo o ya no exista. */}
              {form.environment &&
                !environments.some((env) => env.code === form.environment) && (
                  <option value={form.environment}>{form.environment}</option>
                )}
              {environments
                .filter((env) => env.isActive || env.code === form.environment)
                .map((env) => (
                  <option key={env.id} value={env.code}>
                    {env.name} ({env.code})
                  </option>
                ))}
            </select>
            <small>{t("servers.environmentHint")}</small>
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.useSsl} onChange={(e) => setForm({ ...form, useSsl: e.target.checked })} />
            {t("servers.useSsl")}
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.isCloudSql} onChange={(e) => setForm({ ...form, isCloudSql: e.target.checked })} />
            {t("servers.isCloudSql")}
          </label>
          {form.isCloudSql && (
            <>
              <label>
                {t("servers.gcpProject")}
                <input value={form.gcpProject} onChange={(e) => setForm({ ...form, gcpProject: e.target.value })} />
              </label>
              <label>
                {t("servers.gcpInstance")}
                <input value={form.gcpInstance} onChange={(e) => setForm({ ...form, gcpInstance: e.target.value })} />
              </label>
            </>
          )}
          <label>
            {t("servers.credential")}
            <select
              value={form.credentialId}
              onChange={(e) => setForm({ ...form, credentialId: e.target.value })}
            >
              <option value="">{t("servers.credentialNone")}</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.username})
                </option>
              ))}
            </select>
            <small>{t("servers.credentialHint")}</small>
          </label>
          <label>
            {t("servers.notes")}
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
        </Modal>
      )}
    </section>
  );
}
