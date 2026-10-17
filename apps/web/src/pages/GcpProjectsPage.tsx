import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { DEFAULT_PAGE_SIZE, type GcpProjectDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

interface FormState {
  id: string | null;
  projectId: string;
  name: string;
  description: string;
  isActive: boolean;
}

const emptyForm: FormState = { id: null, projectId: "", name: "", description: "", isActive: true };

/** Catálogo de proyectos GCP: alimenta el selector de proyecto de las instancias. */
export function GcpProjectsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<GcpProjectDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);

  async function reload() {
    setData(
      await api.get<Paginated<GcpProjectDto>>(
        `/gcp-projects?limit=${page.limit}&offset=${page.offset}`,
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
        projectId: form.projectId.trim(),
        name: form.name.trim() || null,
        description: form.description.trim() || null,
        isActive: form.isActive,
      };
      if (form.id) await api.patch(`/gcp-projects/${form.id}`, body);
      else await api.post("/gcp-projects", body);
      setForm(null);
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(p: GcpProjectDto) {
    if (!(await confirm({ message: t("common.confirmDelete", { name: p.projectId }), danger: true }))) return;
    try {
      await api.delete(`/gcp-projects/${p.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("gcpProjects.intro")}</p>
        {canWrite && (
          <button onClick={() => setForm({ ...emptyForm })}>{t("gcpProjects.new")}</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("gcpProjects.projectId")}</th>
              <th>{t("gcpProjects.name")}</th>
              <th>{t("gcpProjects.description")}</th>
              <th>{t("gcpProjects.active")}</th>
              {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t("gcpProjects.empty")}
                </td>
              </tr>
            )}
            {data.items.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>{p.projectId}</code>
                </td>
                <td>{p.name ?? t("common.none")}</td>
                <td>{p.description ?? t("common.none")}</td>
                <td>{p.isActive ? t("common.active") : t("common.inactive")}</td>
                {(canWrite || canDelete) && (
                  <td className="row-actions">
                    {canWrite && (
                      <button
                        className="icon-btn"
                        title={t("common.edit")}
                        aria-label={t("common.edit")}
                        onClick={() =>
                          setForm({
                            id: p.id,
                            projectId: p.projectId,
                            name: p.name ?? "",
                            description: p.description ?? "",
                            isActive: p.isActive,
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
                        onClick={() => remove(p)}
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
          title={form.id ? t("common.edit") : t("gcpProjects.new")}
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
            {t("gcpProjects.projectId")}
            <input
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
              placeholder="mi-proyecto-prd"
            />
            <small>{t("gcpProjects.projectIdHint")}</small>
          </label>
          <label>
            {t("gcpProjects.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t("gcpProjects.description")}
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
            {t("gcpProjects.active")}
          </label>
        </Modal>
      )}
    </section>
  );
}
