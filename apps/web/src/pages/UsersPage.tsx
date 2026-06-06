import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { DEFAULT_PAGE_SIZE, type Paginated, type RoleDto, type UserDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { Pagination } from "../components/Pagination";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

interface FormState {
  id: string | null;
  username: string;
  email: string;
  fullName: string;
  authType: "local" | "ad";
  password: string;
  isActive: boolean;
  roleKeys: string[];
}

const emptyForm: FormState = {
  id: null,
  username: "",
  email: "",
  fullName: "",
  authType: "local",
  password: "",
  isActive: true,
  roleKeys: [],
};

export function UsersPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("users:write");
  const canDelete = has("users:delete");

  const toast = useToast();
  const confirm = useConfirm();

  const [data, setData] = useState<Paginated<UserDto>>({ items: [], total: 0 });
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [page, setPage] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  const [form, setForm] = useState<FormState | null>(null);

  async function reload() {
    const [u, r] = await Promise.all([
      api.get<Paginated<UserDto>>(`/users?limit=${page.limit}&offset=${page.offset}`),
      api.get<RoleDto[]>("/roles"),
    ]);
    setData(u);
    setRoles(r);
  }

  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function startCreate() {
    setForm({ ...emptyForm });
  }

  function startEdit(u: UserDto) {
    setForm({
      id: u.id,
      username: u.username,
      email: u.email ?? "",
      fullName: u.fullName ?? "",
      authType: u.authType,
      password: "",
      isActive: u.isActive,
      roleKeys: u.roles,
    });
  }

  async function submit() {
    if (!form) return;
    try {
      const payload = {
        email: form.email || null,
        fullName: form.fullName || null,
        isActive: form.isActive,
        roleKeys: form.roleKeys,
        ...(form.password ? { password: form.password } : {}),
      };
      if (form.id) {
        await api.patch(`/users/${form.id}`, payload);
      } else {
        await api.post("/users", {
          username: form.username,
          authType: form.authType,
          ...payload,
        });
      }
      setForm(null);
      await reload();
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function remove(u: UserDto) {
    if (!(await confirm({ message: t("common.confirmDelete", { name: u.username }), danger: true }))) return;
    try {
      await api.delete(`/users/${u.id}`);
      await reload();
      toast.success(t("common.deleted"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  function toggleRole(key: string) {
    setForm((f) =>
      f
        ? { ...f, roleKeys: f.roleKeys.includes(key) ? f.roleKeys.filter((k) => k !== key) : [...f.roleKeys, key] }
        : f,
    );
  }

  return (
    <section>
      <div className="page-head">
        {canWrite && <button onClick={startCreate}>{t("users.new")}</button>}
      </div>

      <div className="table-wrap">
        <table className="grid">
        <thead>
          <tr>
            <th>{t("users.username")}</th>
            <th>{t("users.fullName")}</th>
            <th>{t("users.authType")}</th>
            <th>{t("users.roles")}</th>
            <th>{t("users.status")}</th>
            {(canWrite || canDelete) && <th>{t("common.actions")}</th>}
          </tr>
        </thead>
        <tbody>
          {data.items.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.fullName ?? "—"}</td>
              <td>{u.authType === "ad" ? t("users.ad") : t("users.local")}</td>
              <td>{u.roles.join(", ") || "—"}</td>
              <td>{u.isActive ? t("common.active") : t("common.inactive")}</td>
              {(canWrite || canDelete) && (
                <td className="row-actions">
                  {canWrite && (
                    <button className="icon-btn" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => startEdit(u)}>
                      <Pencil size={16} />
                    </button>
                  )}
                  {canDelete && (
                    <button className="icon-btn danger" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => remove(u)}>
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
          title={form.id ? t("common.edit") : t("users.new")}
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
          {!form.id && (
            <label>
              {t("users.username")}
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </label>
          )}
          {!form.id && (
            <label>
              {t("users.authType")}
              <select
                value={form.authType}
                onChange={(e) => setForm({ ...form, authType: e.target.value as "local" | "ad" })}
              >
                <option value="local">{t("users.local")}</option>
                <option value="ad">{t("users.ad")}</option>
              </select>
            </label>
          )}
          <label>
            {t("users.fullName")}
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </label>
          <label>
            {t("users.email")}
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          {form.authType === "local" && (
            <label>
              {t("users.password")}
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <small>{t("users.passwordHint")}</small>
            </label>
          )}
          <label className="inline">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t("common.active")}
          </label>
          <fieldset>
            <legend>{t("users.roles")}</legend>
            {roles.map((r) => (
              <label key={r.key} className="inline">
                <input
                  type="checkbox"
                  checked={form.roleKeys.includes(r.key)}
                  onChange={() => toggleRole(r.key)}
                />
                {r.name}
              </label>
            ))}
          </fieldset>
        </Modal>
      )}
    </section>
  );
}
