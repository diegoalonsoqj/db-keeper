import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Star, Trash2 } from "lucide-react";
import {
  DEFAULT_PAGE_SIZE,
  STORAGE_TYPES,
  type GcpServiceAccountDto,
  type Paginated,
  type StorageTargetDto,
  type StorageType,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

interface FormState {
  id: string | null;
  type: StorageType;
  name: string;
  path: string;
  bucket: string;
  prefix: string;
  isActive: boolean;
  gcpServiceAccountId: string;
}

const emptyForm: FormState = {
  id: null,
  type: "local",
  name: "",
  path: "",
  bucket: "",
  prefix: "",
  isActive: true,
  gcpServiceAccountId: "",
};

export function StoragePage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");

  const [data, setData] = useState<Paginated<StorageTargetDto>>({ items: [], total: 0 });
  const [accounts, setAccounts] = useState<GcpServiceAccountDto[]>([]);
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [tgts, accs] = await Promise.all([
      api.get<Paginated<StorageTargetDto>>(`/storage?limit=${page.limit}&offset=${page.offset}`),
      api.get<Paginated<GcpServiceAccountDto>>("/gcp-accounts?limit=100"),
    ]);
    setData(tgts);
    setAccounts(accs.items);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof ApiClientError ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function startEdit(s: StorageTargetDto) {
    setError(null);
    setForm({
      id: s.id,
      type: s.type,
      name: s.name,
      path: s.path ?? "",
      bucket: s.bucket ?? "",
      prefix: s.prefix ?? "",
      isActive: s.isActive,
      gcpServiceAccountId: s.gcpServiceAccountId ?? "",
    });
  }

  async function submit() {
    if (!form) return;
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        name: form.name,
        isActive: form.isActive,
        path: form.type === "local" ? form.path : null,
        bucket: form.type === "gcs" ? form.bucket : null,
        prefix: form.type === "gcs" ? form.prefix || null : null,
        gcpServiceAccountId: form.type === "gcs" ? form.gcpServiceAccountId || null : null,
      };
      if (form.id) await api.patch(`/storage/${form.id}`, payload);
      else await api.post("/storage", payload);
      setForm(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  async function remove(s: StorageTargetDto) {
    if (!confirm(t("common.confirm"))) return;
    try {
      await api.delete(`/storage/${s.id}`);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("storage.intro")}</p>
        {canWrite && <button onClick={() => (setError(null), setForm({ ...emptyForm }))}>{t("storage.new")}</button>}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("storage.name")}</th>
              <th>{t("storage.type")}</th>
              <th>{t("storage.location")}</th>
              <th>{t("storage.default")}</th>
              <th>{t("storage.status")}</th>
              {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t("storage.empty")}
                </td>
              </tr>
            )}
            {data.items.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{t(`storage.type_${s.type}`)}</td>
                <td>
                  <code>{s.type === "local" ? s.path : `${s.bucket}${s.prefix ? `/${s.prefix}` : ""}`}</code>
                </td>
                <td>
                  {s.isDefault && (
                    <span className="star-default" title={t("storage.isDefault")} aria-label={t("storage.isDefault")}>
                      <Star size={16} fill="currentColor" /> {t("storage.default")}
                    </span>
                  )}
                </td>
                <td>{s.isActive ? t("common.active") : t("common.inactive")}</td>
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
          title={form.id ? t("common.edit") : t("storage.new")}
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
            {t("storage.type")}
            <select
              value={form.type}
              disabled={!!form.id}
              onChange={(e) => setForm({ ...form, type: e.target.value as StorageType })}
            >
              {STORAGE_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`storage.type_${ty}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("storage.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>

          {form.type === "local" ? (
            <label>
              {t("storage.path")}
              <input
                value={form.path}
                onChange={(e) => setForm({ ...form, path: e.target.value })}
                placeholder="/var/backups/dbkeeper"
              />
              <small>{t("storage.pathHint")}</small>
            </label>
          ) : (
            <>
              <label>
                {t("storage.bucket")}
                <input value={form.bucket} onChange={(e) => setForm({ ...form, bucket: e.target.value })} placeholder="mi-empresa-backups" />
              </label>
              <label>
                {t("storage.prefix")}
                <input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
              </label>
              <label>
                {t("storage.account")}
                <select
                  value={form.gcpServiceAccountId}
                  onChange={(e) => setForm({ ...form, gcpServiceAccountId: e.target.value })}
                >
                  <option value="">{t("storage.accountNone")}</option>
                  {accounts
                    .filter((a) => a.isActive || a.id === form.gcpServiceAccountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.clientEmail ? ` (${a.clientEmail})` : ""}
                      </option>
                    ))}
                </select>
                <small>{t("storage.accountHint")}</small>
              </label>
            </>
          )}

          <label className="inline">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {t("common.active")}
          </label>
        </Modal>
      )}
    </section>
  );
}
