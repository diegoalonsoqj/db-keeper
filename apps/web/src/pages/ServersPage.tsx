import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DB_ENGINES, DEFAULT_PORTS, type DbEngine, type ServerDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

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
  credUsername: string;
  credPassword: string;
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
  credUsername: "",
  credPassword: "",
};

export function ServersPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");

  const [servers, setServers] = useState<ServerDto[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setServers(await api.get<ServerDto[]>("/servers"));
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
  }, []);

  function startEdit(s: ServerDto) {
    setError(null);
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
      credUsername: s.credentialUsername ?? "",
      credPassword: "",
    });
  }

  async function submit() {
    if (!form) return;
    setError(null);
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
        credential: {
          username: form.credUsername,
          ...(form.credPassword ? { password: form.credPassword } : {}),
        },
      };
      if (form.id) await api.patch(`/servers/${form.id}`, base);
      else await api.post("/servers", base);
      setForm(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  async function remove(s: ServerDto) {
    if (!confirm(t("common.confirm"))) return;
    try {
      await api.delete(`/servers/${s.id}`);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>{t("servers.title")}</h1>
        {canWrite && <button onClick={() => (setError(null), setForm({ ...emptyForm }))}>{t("servers.new")}</button>}
      </div>
      {error && <p className="error">{error}</p>}

      <table className="grid">
        <thead>
          <tr>
            <th>{t("servers.name")}</th>
            <th>{t("servers.engine")}</th>
            <th>{t("servers.host")}</th>
            <th>{t("servers.port")}</th>
            <th>{t("servers.environment")}</th>
            <th>{t("servers.credUsername")}</th>
            {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
          </tr>
        </thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.engine}{s.isCloudSql ? " · Cloud SQL" : ""}</td>
              <td>{s.host}{s.useSsl ? " 🔒" : ""}</td>
              <td>{s.port}</td>
              <td>{s.environment ?? t("common.none")}</td>
              <td>{s.credentialUsername ?? t("common.none")}</td>
              {(canWrite || canDelete) && (
                <td className="row-actions">
                  {canWrite && <button onClick={() => startEdit(s)}>{t("common.edit")}</button>}
                  {canDelete && <button className="danger" onClick={() => remove(s)}>{t("common.delete")}</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {form && (
        <div className="card form-card">
          <h2>{form.id ? t("common.edit") : t("servers.new")}</h2>
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
            <input value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} />
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
          <fieldset>
            <legend>{t("servers.credentials")}</legend>
            <label style={{ flex: 1 }}>
              {t("servers.credUsername")}
              <input value={form.credUsername} onChange={(e) => setForm({ ...form, credUsername: e.target.value })} />
            </label>
            <label style={{ flex: 1 }}>
              {t("servers.credPassword")}
              <input
                type="password"
                value={form.credPassword}
                onChange={(e) => setForm({ ...form, credPassword: e.target.value })}
              />
              {form.id && <small>{t("servers.credPasswordHintEdit")}</small>}
            </label>
          </fieldset>
          <label>
            {t("servers.notes")}
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="form-actions">
            <button onClick={submit}>{t("common.save")}</button>
            <button className="secondary" onClick={() => setForm(null)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}
    </section>
  );
}
