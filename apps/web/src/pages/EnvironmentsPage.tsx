import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { DEFAULT_PAGE_SIZE, type EnvironmentDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

interface FormState {
  id: string | null;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
}

const emptyForm: FormState = { id: null, name: "", code: "", description: "", isActive: true };

export function EnvironmentsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<EnvironmentDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);

  async function reload() {
    setData(
      await api.get<Paginated<EnvironmentDto>>(
        `/environments?limit=${page.limit}&offset=${page.offset}`,
      ),
    );
  }
  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function submit() {
    if (!form) return;
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        description: form.description.trim() || null,
        isActive: form.isActive,
      };
      if (form.id) await api.patch(`/environments/${form.id}`, body);
      else await api.post("/environments", body);
      setForm(null);
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(env: EnvironmentDto) {
    if (!(await confirm({ message: t("common.confirmDelete", { name: env.name }), danger: true }))) return;
    try {
      await api.delete(`/environments/${env.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("environments.intro")}</p>
        {canWrite && (
          <button onClick={() => setForm({ ...emptyForm })}>{t("environments.new")}</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("environments.code")}</th>
              <th>{t("environments.name")}</th>
              <th>{t("environments.description")}</th>
              <th>{t("environments.active")}</th>
              {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("environments.empty")}
                </td>
              </tr>
            )}
            {data.items.map((env) => (
              <tr key={env.id}>
                <td>
                  <code>{env.code}</code>
                </td>
                <td>{env.name}</td>
                <td>{env.description ?? t("common.none")}</td>
                <td>{env.isActive ? t("common.active") : t("common.inactive")}</td>
                {(canWrite || canDelete) && (
                  <td className="row-actions">
                    {canWrite && (
                      <button
                        className="icon-btn"
                        title={t("common.edit")}
                        aria-label={t("common.edit")}
                        onClick={() =>
                          setForm({
                            id: env.id,
                            name: env.name,
                            code: env.code,
                            description: env.description ?? "",
                            isActive: env.isActive,
                          })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="icon-btn danger"
                        title={t("common.delete")}
                        aria-label={t("common.delete")}
                        onClick={() => remove(env)}
                      >
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
          title={form.id ? t("common.edit") : t("environments.new")}
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
            {t("environments.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t("environments.code")}
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="PRD"
            />
            <small>{t("environments.codeHint")}</small>
          </label>
          <label>
            {t("environments.description")}
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t("environments.active")}
          </label>
        </Modal>
      )}
    </section>
  );
}
