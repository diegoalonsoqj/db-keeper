import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { DEFAULT_PAGE_SIZE, type BucketDto, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

interface FormState {
  id: string | null;
  name: string;
  bucket: string;
  prefix: string;
  isActive: boolean;
  serviceAccount: string;
}

const emptyForm: FormState = { id: null, name: "", bucket: "", prefix: "", isActive: true, serviceAccount: "" };

export function BucketsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");

  const [data, setData] = useState<Paginated<BucketDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setData(await api.get<Paginated<BucketDto>>(`/buckets?limit=${page.limit}&offset=${page.offset}`));
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function startEdit(b: BucketDto) {
    setError(null);
    setForm({ id: b.id, name: b.name, bucket: b.bucket, prefix: b.prefix ?? "", isActive: b.isActive, serviceAccount: "" });
  }

  async function submit() {
    if (!form) return;
    setError(null);
    try {
      const payload = {
        name: form.name,
        bucket: form.bucket,
        prefix: form.prefix || null,
        isActive: form.isActive,
        ...(form.serviceAccount ? { serviceAccount: form.serviceAccount } : {}),
      };
      if (form.id) await api.patch(`/buckets/${form.id}`, payload);
      else await api.post("/buckets", payload);
      setForm(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  async function remove(b: BucketDto) {
    if (!confirm(t("common.confirm"))) return;
    try {
      await api.delete(`/buckets/${b.id}`);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        {canWrite && <button onClick={() => (setError(null), setForm({ ...emptyForm }))}>{t("buckets.new")}</button>}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table className="grid">
        <thead>
          <tr>
            <th>{t("buckets.name")}</th>
            <th>{t("buckets.provider")}</th>
            <th>{t("buckets.bucket")}</th>
            <th>{t("buckets.prefix")}</th>
            <th>{t("buckets.hasServiceAccount")}</th>
            <th>{t("buckets.status")}</th>
            {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
          </tr>
        </thead>
        <tbody>
          {data.items.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>{b.provider.toUpperCase()}</td>
              <td><code>{b.bucket}</code></td>
              <td>{b.prefix ?? t("common.none")}</td>
              <td>{b.hasServiceAccount ? t("common.yes") : t("common.no")}</td>
              <td>{b.isActive ? t("common.active") : t("common.inactive")}</td>
              {(canWrite || canDelete) && (
                <td className="row-actions">
                  {canWrite && (
                    <button className="icon-btn" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => startEdit(b)}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button className="icon-btn danger" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => remove(b)}>
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
          title={form.id ? t("common.edit") : t("buckets.new")}
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
            {t("buckets.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            {t("buckets.bucket")}
            <input value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })} placeholder="mi-empresa-backups" />
          </label>
          <label>
            {t("buckets.prefix")}
            <input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
          </label>
          <label>
            {t("buckets.serviceAccount")}
            <textarea
              rows={4}
              value={form.serviceAccount}
              onChange={(e) => setForm({ ...form, serviceAccount: e.target.value })}
            />
            <small>{t("buckets.serviceAccountHint")}</small>
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
