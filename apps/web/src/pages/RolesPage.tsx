import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PermissionDto, RoleDto } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

export function RolesPage() {
  const { t } = useTranslation();
  const { has } = useAuth();
  const canWrite = has("roles:write");
  const toast = useToast();

  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [perms, setPerms] = useState<PermissionDto[]>([]);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});

  async function reload() {
    const [r, p] = await Promise.all([
      api.get<RoleDto[]>("/roles"),
      api.get<PermissionDto[]>("/permissions"),
    ]);
    setRoles(r);
    setPerms(p);
    setDraft(Object.fromEntries(r.map((role) => [role.id, new Set(role.permissions)])));
  }

  useEffect(() => {
    reload().catch((e) => toast.error(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, PermissionDto[]>();
    for (const p of perms) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return [...map.entries()];
  }, [perms]);

  function toggle(roleId: string, key: string) {
    setDraft((d) => {
      const set = new Set(d[roleId]);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...d, [roleId]: set };
    });
  }

  async function save(role: RoleDto) {
    try {
      await api.patch(`/roles/${role.id}`, { permissions: [...(draft[role.id] ?? [])] });
      toast.success(`${role.name}: ${t("roles.saved")}`);
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <section>

      <div className="matrix-wrap">
        <table className="grid matrix">
          <thead>
            <tr>
              <th>{t("roles.permissions")}</th>
              {roles.map((r) => (
                <th key={r.id} title={r.description ?? ""}>
                  {r.name}
                  {r.key === "superadmin" && <span className="lock" title={t("roles.superadminLocked")}> 🔒</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(([cat, list]) => (
              <Fragment key={`cat-${cat}`}>
                <tr className="cat-row">
                  <td colSpan={roles.length + 1}>{cat}</td>
                </tr>
                {list.map((p) => (
                  <tr key={p.key}>
                    <td title={p.description}>{p.key}</td>
                    {roles.map((r) => {
                      const locked = r.key === "superadmin" || !canWrite;
                      return (
                        <td key={r.id} className="center">
                          <input
                            type="checkbox"
                            checked={draft[r.id]?.has(p.key) ?? false}
                            disabled={locked}
                            onChange={() => toggle(r.id, p.key)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          {canWrite && (
            <tfoot>
              <tr>
                <td></td>
                {roles.map((r) => (
                  <td key={r.id} className="center">
                    {r.key !== "superadmin" && (
                      <button onClick={() => save(r)}>{t("common.save")}</button>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
