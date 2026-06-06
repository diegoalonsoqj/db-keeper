import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import {
  DEFAULT_PAGE_SIZE,
  type CredentialDto,
  type EnvironmentDto,
  type Paginated,
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
  username: string;
  password: string;
  environment: string;
  description: string;
  extra: string;
  hasExtra: boolean;
}

const emptyForm: FormState = {
  id: null,
  name: "",
  username: "",
  password: "",
  environment: "",
  description: "",
  extra: "",
  hasExtra: false,
};

export function CredentialsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<CredentialDto>>({ items: [], total: 0 });
  const [environments, setEnvironments] = useState<EnvironmentDto[]>([]);
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);

  async function reload() {
    const [creds, envs] = await Promise.all([
      api.get<Paginated<CredentialDto>>(`/credentials?limit=${page.limit}&offset=${page.offset}`),
      api.get<Paginated<EnvironmentDto>>("/environments?limit=100"),
    ]);
    setData(creds);
    setEnvironments(envs.items);
  }
  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function startEdit(c: CredentialDto) {
    setForm({
      id: c.id,
      name: c.name,
      username: c.username,
      password: "",
      environment: c.environment ?? "",
      description: c.description ?? "",
      extra: "",
      hasExtra: c.hasExtra,
    });
  }

  async function submit() {
    if (!form) return;

    let extra: Record<string, unknown> | null | undefined;
    if (form.extra.trim()) {
      try {
        extra = JSON.parse(form.extra) as Record<string, unknown>;
      } catch {
        toast.error(t("credentials.extraInvalid"));
        return;
      }
    } else if (form.id) {
      // En edición, vacío = no tocar el extra actual; en alta, vacío = sin extra.
      extra = undefined;
    } else {
      extra = null;
    }

    try {
      const body: Record<string, unknown> = {
        name: form.name,
        username: form.username,
        environment: form.environment || null,
        description: form.description || null,
      };
      if (form.password) body.password = form.password;
      if (extra !== undefined) body.extra = extra;

      if (form.id) await api.patch(`/credentials/${form.id}`, body);
      else await api.post("/credentials", body);
      setForm(null);
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(c: CredentialDto) {
    if (!(await confirm({ message: t("common.confirmDelete", { name: c.name }), danger: true }))) return;
    try {
      await api.delete(`/credentials/${c.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("credentials.intro")}</p>
        {canWrite && <button onClick={() => setForm({ ...emptyForm })}>{t("credentials.new")}</button>}
      </div>

      <div className="table-wrap">
        <table className="grid">
        <thead>
          <tr>
            <th>{t("credentials.name")}</th>
            <th>{t("credentials.username")}</th>
            <th>{t("credentials.environment")}</th>
            <th>{t("credentials.description")}</th>
            <th>{t("credentials.extra")}</th>
            {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
          </tr>
        </thead>
        <tbody>
          {data.items.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.username}</td>
              <td>{environmentLabel(environments, c.environment) ?? t("common.none")}</td>
              <td>{c.description ?? t("common.none")}</td>
              <td>{c.hasExtra ? t("common.yes") : t("common.no")}</td>
              {(canWrite || canDelete) && (
                <td className="row-actions">
                  {canWrite && (
                    <button className="icon-btn" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => startEdit(c)}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button className="icon-btn danger" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => remove(c)}>
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
          title={form.id ? t("common.edit") : t("credentials.new")}
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
            {t("credentials.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t("credentials.username")}
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            {t("credentials.password")}
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {form.id && <small>{t("credentials.passwordHintEdit")}</small>}
          </label>
          <label>
            {t("credentials.environment")}
            <select
              value={form.environment}
              onChange={(e) => setForm({ ...form, environment: e.target.value })}
            >
              <option value="">{t("credentials.environmentNone")}</option>
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
          </label>
          <label>
            {t("credentials.description")}
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label>
            {t("credentials.extra")}
            <textarea
              rows={4}
              value={form.extra}
              placeholder={t("credentials.extraPlaceholder")}
              onChange={(e) => setForm({ ...form, extra: e.target.value })}
            />
            <small>
              {form.hasExtra && !form.extra ? t("credentials.extraHintKeep") : t("credentials.extraHint")}
            </small>
          </label>
        </Modal>
      )}
    </section>
  );
}
