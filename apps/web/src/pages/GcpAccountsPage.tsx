import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Star, Trash2 } from "lucide-react";
import { DEFAULT_PAGE_SIZE, type GcpServiceAccountDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

interface FormState {
  id: string | null;
  name: string;
  key: string;
  isActive: boolean;
}

const emptyForm: FormState = { id: null, name: "", key: "", isActive: true };

export function GcpAccountsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");

  const [data, setData] = useState<Paginated<GcpServiceAccountDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setData(await api.get<Paginated<GcpServiceAccountDto>>(`/gcp-accounts?limit=${page.limit}&offset=${page.offset}`));
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function submit() {
    if (!form) return;
    setError(null);
    try {
      const body: Record<string, unknown> = { name: form.name.trim(), isActive: form.isActive };
      if (form.key.trim()) body.key = form.key.trim();
      if (form.id) await api.patch(`/gcp-accounts/${form.id}`, body);
      else await api.post("/gcp-accounts", body);
      setForm(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  async function remove(a: GcpServiceAccountDto) {
    if (!confirm(t("common.confirm"))) return;
    try {
      await api.delete(`/gcp-accounts/${a.id}`);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("gcp.intro")}</p>
        {canWrite && <button onClick={() => (setError(null), setForm({ ...emptyForm }))}>{t("gcp.new")}</button>}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("gcp.name")}</th>
              <th>{t("gcp.clientEmail")}</th>
              <th>{t("gcp.projectId")}</th>
              <th>{t("gcp.default")}</th>
              <th>{t("gcp.status")}</th>
              {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t("gcp.empty")}
                </td>
              </tr>
            )}
            {data.items.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.clientEmail ?? t("common.none")}</td>
                <td>{a.projectId ?? t("common.none")}</td>
                <td>
                  {a.isDefault && (
                    <span className="star-default" title={t("gcp.isDefault")} aria-label={t("gcp.isDefault")}>
                      <Star size={16} fill="currentColor" /> {t("gcp.default")}
                    </span>
                  )}
                </td>
                <td>{a.isActive ? t("common.active") : t("common.inactive")}</td>
                {(canWrite || canDelete) && (
                  <td className="row-actions">
                    {canWrite && (
                      <button
                        className="icon-btn"
                        title={t("common.edit")}
                        aria-label={t("common.edit")}
                        onClick={() => setForm({ id: a.id, name: a.name, key: "", isActive: a.isActive })}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    {canDelete && (
                      <button className="icon-btn danger" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => remove(a)}>
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
          title={form.id ? t("common.edit") : t("gcp.new")}
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
            {t("gcp.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t("gcp.key")}
            <textarea
              rows={6}
              value={form.key}
              placeholder={t("gcp.keyPlaceholder")}
              onChange={(e) => setForm({ ...form, key: e.target.value })}
            />
            <small>{form.id ? t("gcp.keyHintEdit") : t("gcp.keyHint")}</small>
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {t("common.active")}
          </label>
        </Modal>
      )}
    </section>
  );
}
