import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Star, Trash2 } from "lucide-react";
import {
  CLOUD_PROVIDERS,
  DEFAULT_PAGE_SIZE,
  type CloudCredentialDto,
  type CloudProvider,
  type ComputeIdentityDto,
  type Paginated,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

interface FormState {
  id: string | null;
  /** true si edita la cuenta de la VM (no lleva clave). */
  isCompute: boolean;
  provider: CloudProvider;
  name: string;
  secret: string;
  isActive: boolean;
}

const emptyForm: FormState = { id: null, isCompute: false, provider: "gcp", name: "", secret: "", isActive: true };

/** Email/proyecto (GCP) u otros metadatos para identificar la cuenta. */
function metaLabel(c: CloudCredentialDto): string {
  const m = c.metadata as { clientEmail?: string; projectId?: string };
  const parts = [m.clientEmail, m.projectId].filter(Boolean);
  return parts.join(" · ");
}

export function CloudCredentialsPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("servers:write");
  const canDelete = has("servers:delete");
  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<CloudCredentialDto>>({ items: [], total: 0 });
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);
  // Cuenta de servicio de la VM (Compute Engine) donde corre DBKeeper, si la hay.
  const [compute, setCompute] = useState<ComputeIdentityDto | null>(null);

  async function reload() {
    const [list, vm] = await Promise.all([
      api.get<Paginated<CloudCredentialDto>>(`/cloud-credentials?limit=${page.limit}&offset=${page.offset}`),
      api.get<ComputeIdentityDto>("/cloud-credentials/compute"),
    ]);
    setData(list);
    setCompute(vm);
  }

  async function addCompute() {
    try {
      await api.post("/cloud-credentials/compute", {});
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function submit() {
    if (!form) return;
    try {
      const body: Record<string, unknown> = { name: form.name.trim(), isActive: form.isActive };
      if (!form.id) body.provider = form.provider;
      if (!form.isCompute && form.secret.trim()) body.secret = form.secret.trim();
      if (form.id) await api.patch(`/cloud-credentials/${form.id}`, body);
      else await api.post("/cloud-credentials", body);
      setForm(null);
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(c: CloudCredentialDto) {
    if (!(await confirm({ message: t("common.confirmDelete", { name: c.name }), danger: true }))) return;
    try {
      await api.delete(`/cloud-credentials/${c.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>
      <div className="page-head">
        <p className="page-desc muted">{t("cloud.intro")}</p>
        {canWrite && <button onClick={() => setForm({ ...emptyForm })}>{t("cloud.new")}</button>}
      </div>

      {compute?.available && (
        <div className="card">
          <p>
            {t("cloud.computeDetected")} <strong>{compute.email}</strong>
            {compute.projectId ? ` · ${compute.projectId}` : ""}
          </p>
          {compute.missingScopes.length > 0 && (
            <p className="error">{t("cloud.computeScopesWarn", { missing: compute.missingScopes.join(", ") })}</p>
          )}
          {compute.credentialId ? (
            <small className="muted">{t("cloud.computeAdded")}</small>
          ) : (
            canWrite && (
              <>
                <button onClick={addCompute}>{t("cloud.computeAdd")}</button>
                <small className="muted"> {t("cloud.computeAddHint")}</small>
              </>
            )
          )}
        </div>
      )}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t("cloud.name")}</th>
              <th>{t("cloud.provider")}</th>
              <th>{t("cloud.identity")}</th>
              <th>{t("cloud.default")}</th>
              <th>{t("cloud.status")}</th>
              {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t("cloud.empty")}
                </td>
              </tr>
            )}
            {data.items.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{t(`cloud.provider_${c.provider}`)}</td>
                <td>
                  {c.kind === "compute" && <span className="badge">{t("cloud.kindCompute")}</span>} {metaLabel(c) || t("common.none")}
                </td>
                <td>
                  {c.isDefault && (
                    <span className="star-default" title={t("cloud.isDefault")} aria-label={t("cloud.isDefault")}>
                      <Star size={16} fill="currentColor" /> {t("cloud.default")}
                    </span>
                  )}
                </td>
                <td>{c.isActive ? t("common.active") : t("common.inactive")}</td>
                {(canWrite || canDelete) && (
                  <td className="row-actions">
                    {canWrite && (
                      <button
                        className="icon-btn"
                        title={t("common.edit")}
                        aria-label={t("common.edit")}
                        onClick={() => setForm({ id: c.id, isCompute: c.kind === "compute", provider: c.provider, name: c.name, secret: "", isActive: c.isActive })}
                      >
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
          title={form.id ? t("common.edit") : t("cloud.new")}
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
            {t("cloud.provider")}
            <select
              value={form.provider}
              disabled={!!form.id}
              onChange={(e) => setForm({ ...form, provider: e.target.value as CloudProvider })}
            >
              {CLOUD_PROVIDERS.map((p) => (
                <option key={p} value={p} disabled={p !== "gcp"}>
                  {t(`cloud.provider_${p}`)}
                  {p !== "gcp" ? ` (${t("cloud.soon")})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("cloud.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          {form.isCompute ? (
            <small className="muted">{t("cloud.computeNoKey")}</small>
          ) : (
            <label>
              {t("cloud.secret")}
              <textarea
                rows={6}
                value={form.secret}
                placeholder={t("cloud.secretPlaceholder")}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
              />
              <small>{form.id ? t("cloud.secretHintEdit") : t("cloud.secretHint")}</small>
            </label>
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
