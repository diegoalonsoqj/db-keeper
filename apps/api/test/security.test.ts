import { beforeEach, describe, expect, it, vi } from "vitest";

// Los módulos leen la config al importarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

import { ALL_PERMISSION_KEYS, databaseNameError, ROLE_DEFAULT_PERMISSIONS, type AuthIdentity } from "@dbkeeper/shared";

// ---- Repositorios simulados (sin BD) ----
const users = new Map<string, { id: string; username: string; authType: "local"; isActive: boolean; roles: string[] }>();
const rolePerms: Record<string, string[]> = {
  superadmin: ALL_PERMISSION_KEYS,
  admin: ROLE_DEFAULT_PERMISSIONS.admin,
  editor: ROLE_DEFAULT_PERMISSIONS.editor,
  viewer: ROLE_DEFAULT_PERMISSIONS.viewer,
  // Rol personalizado con un permiso que el admin no tiene.
  rolesadmin: ["roles:read", "roles:write"],
};

vi.mock("../src/modules/users/users.repository.js", () => ({
  findById: vi.fn(async (id: string) => users.get(id) ?? null),
  findByUsername: vi.fn(async () => null),
  getUserPermissions: vi.fn(async (id: string) => [...new Set((users.get(id)?.roles ?? []).flatMap((r) => rolePerms[r] ?? []))]),
  countActiveSuperadmins: vi.fn(
    async (exclude: string) => [...users.values()].filter((u) => u.id !== exclude && u.isActive && u.roles.includes("superadmin")).length,
  ),
  insertUser: vi.fn(async () => "new-id"),
  updateUser: vi.fn(async () => {}),
  setUserRoles: vi.fn(async () => {}),
  deleteUser: vi.fn(async () => {}),
}));
const sessions = vi.hoisted(() => ({ revokeAllSessions: vi.fn(async () => {}) }));
vi.mock("../src/modules/auth/sessions.repository.js", () => sessions);
vi.mock("../src/modules/roles/roles.repository.js", () => ({
  listRoles: vi.fn(async () =>
    Object.entries(rolePerms).map(([key, permissions]) => ({ id: key, key, name: key, permissions })),
  ),
  findRoleById: vi.fn(async (id: string) => (rolePerms[id] ? { id, key: id, name: id, permissions: rolePerms[id] } : null)),
  findRoleByKey: vi.fn(async () => null),
  insertRole: vi.fn(async () => "new-role"),
  updateRoleMeta: vi.fn(async () => {}),
  setRolePermissions: vi.fn(async () => {}),
}));

const usersService = await import("../src/modules/users/users.service.js");
const rolesService = await import("../src/modules/roles/roles.service.js");

function actor(id: string): AuthIdentity {
  const u = users.get(id)!;
  return {
    user: { ...u, email: null, fullName: null, lastLoginAt: null, createdAt: "", updatedAt: "" } as never,
    permissions: [...new Set(u.roles.flatMap((r) => rolePerms[r] ?? []))] as never,
  };
}

beforeEach(() => {
  users.clear();
  for (const [id, roles] of [
    ["root", ["superadmin"]],
    ["adm", ["admin"]],
    ["ed", ["editor"]],
    ["ra", ["rolesadmin"]],
  ] as const) {
    users.set(id, { id, username: id, authType: "local", isActive: true, roles: [...roles] });
  }
});

describe("escalada de privilegios: usuarios", () => {
  it("un admin no puede asignarse ni asignar el rol superadmin", async () => {
    await expect(usersService.updateUser(actor("adm"), "ed", { roleKeys: ["superadmin"] })).rejects.toThrow(/superadmin/i);
    await expect(
      usersService.createUser(actor("adm"), {
        username: "x", email: null, fullName: null, authType: "local", password: "12345678", isActive: true, roleKeys: ["superadmin"],
      }),
    ).rejects.toThrow(/superadmin/i);
  });

  it("un admin no puede cambiar la contraseña ni eliminar a un superadmin", async () => {
    await expect(usersService.updateUser(actor("adm"), "root", { password: "nueva-clave-123" })).rejects.toThrow(/superadministrador/);
    await expect(usersService.deleteUser(actor("adm"), "root")).rejects.toThrow(/superadministrador/);
  });

  it("no se asignan roles con permisos que el actor no tiene", async () => {
    await expect(usersService.updateUser(actor("adm"), "ed", { roleKeys: ["editor", "rolesadmin"] })).rejects.toThrow(/roles:write/);
  });

  it("no se modifica a un usuario con más permisos que el actor", async () => {
    await expect(usersService.updateUser(actor("adm"), "ra", { password: "nueva-clave-123" })).rejects.toThrow(/roles:write/);
  });

  it("nadie cambia sus propios roles ni se desactiva", async () => {
    await expect(usersService.updateUser(actor("adm"), "adm", { roleKeys: ["admin", "editor"] })).rejects.toThrow(/propios roles/);
    await expect(usersService.updateUser(actor("adm"), "adm", { isActive: false })).rejects.toThrow(/propios roles/);
  });

  it("debe quedar al menos un superadmin activo", async () => {
    // Con dos superadmins, uno puede desactivar al otro.
    users.set("root2", { id: "root2", username: "root2", authType: "local", isActive: true, roles: ["superadmin"] });
    await expect(usersService.updateUser(actor("root2"), "root", { isActive: false })).resolves.toBeDefined();
    // Si "root" es el único activo, no se le puede quitar el rol ni eliminar.
    users.get("root")!.isActive = true;
    const ghost = actor("root2");
    users.delete("root2");
    await expect(usersService.updateUser(ghost, "root", { roleKeys: ["admin"] })).rejects.toThrow(/al menos un superadministrador/);
    await expect(usersService.deleteUser(ghost, "root")).rejects.toThrow(/al menos un superadministrador/);
  });

  it("lo permitido sigue funcionando", async () => {
    await expect(usersService.updateUser(actor("adm"), "ed", { roleKeys: ["editor", "viewer"], password: "nueva-clave-123" })).resolves.toBeDefined();
    await expect(usersService.updateUser(actor("root"), "adm", { roleKeys: ["superadmin"] })).resolves.toBeDefined();
 
    // La contraseña puesta por el admin cierra las sesiones del usuario; cambiar roles no.
    expect(sessions.revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(sessions.revokeAllSessions).toHaveBeenCalledWith("ed");
  });
});

describe("escalada de privilegios: roles", () => {
  it("no se otorgan a un rol permisos que el actor no tiene", async () => {
    await expect(
      rolesService.createRole(actor("ra"), { key: "x", name: "x", description: null, permissions: ["users:write"] }),
    ).rejects.toThrow(/users:write/);
    await expect(rolesService.updateRole(actor("ra"), "rolesadmin", { permissions: ["roles:read", "roles:write", "settings:write"] })).rejects.toThrow(
      /settings:write/,
    );
  });

  it("conservar o quitar permisos sí se permite", async () => {
    await expect(rolesService.updateRole(actor("ra"), "rolesadmin", { permissions: ["roles:read"] })).resolves.toBeDefined();
  });
});

describe("databaseNameError (pg_dump / mysqldump)", () => {
  it("acepta nombres normales", () => {
    for (const n of ["ventas", "Ventas_2026", "mi-bd", "bd con espacios", "ñandú", "db.prod"]) expect(databaseNameError(n)).toBeNull();
  });

  it("rechaza cadenas de conexión, opciones y caracteres de control", () => {
    for (const n of [
      "host=servidor-atacante dbname=x",
      "dbname=x",
      "postgresql://u:p@servidor-atacante/db",
      "POSTGRES://servidor-atacante/db",
      "--host=servidor-atacante",
      "-hservidor",
      "bd\nmala",
      "   ",
    ]) {
      expect(databaseNameError(n), n).not.toBeNull();
    }
  });
});
