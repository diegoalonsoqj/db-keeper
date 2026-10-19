import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const users = new Map<string, Record<string, unknown>>();
vi.mock("../src/modules/users/users.repository.js", () => ({
  findByUsername: vi.fn(async (u: string) => users.get(u.trim().toLowerCase()) ?? null),
  touchLastLogin: vi.fn(async () => {}),
}));
vi.mock("../src/modules/settings/settings.service.js", () => ({ getLdapRuntimeConfig: vi.fn(async () => null) }));
vi.mock("../src/modules/auth/sessions.repository.js", () => ({ revokeAllSessions: vi.fn() }));
const pwd = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/lib/password.js", async (orig) => {
  const real = await orig<typeof import("../src/lib/password.js")>();
  return {
    ...real,
    verifyPassword: vi.fn(async (p: string, h: string) => {
      pwd.calls++;
      return real.verifyPassword(p, h);
    }),
  };
});

import { hashPassword } from "../src/lib/password.js";
import { login } from "../src/modules/auth/auth.service.js";

const user = (username: string, extra: Record<string, unknown>) => ({
  id: `${username}-id`,
  username,
  authType: "local",
  isActive: true,
  totpEnabled: false,
  roles: [],
  ...extra,
});

beforeAll(async () => {
  const hash = await hashPassword("correcta-123");
  users.set("activo", user("activo", { passwordHash: hash }));
  users.set("inactivo", user("inactivo", { passwordHash: hash, isActive: false }));
  users.set("jperez", user("jperez", { authType: "ad", passwordHash: null }));
});
beforeEach(() => {
  pwd.calls = 0;
});

describe("login: no revela qué usuarios existen", () => {
  it("usuario inexistente: mismo error y también verifica una contraseña (mismo tiempo)", async () => {
    await expect(login("no-existe", "x")).rejects.toMatchObject({ status: 401, message: "Usuario o contraseña inválidos" });
    expect(pwd.calls).toBe(1);
  });

  it("contraseña incorrecta de un usuario existente: el mismo error", async () => {
    await expect(login("activo", "mala")).rejects.toMatchObject({ status: 401, message: "Usuario o contraseña inválidos" });
  });

  it("cuenta inactiva con contraseña incorrecta: no se delata que existe", async () => {
    await expect(login("inactivo", "mala")).rejects.toMatchObject({ status: 401, message: "Usuario o contraseña inválidos" });
  });

  it("cuenta inactiva con la contraseña correcta: ahí sí se avisa", async () => {
    await expect(login("inactivo", "correcta-123")).rejects.toMatchObject({ status: 403 });
  });

  it("usuario AD con LDAP sin configurar: el error genérico", async () => {
    await expect(login("jperez", "x")).rejects.toMatchObject({ status: 401, message: "Usuario o contraseña inválidos" });
  });

  it("DOMINIO\\usuario que resuelve a una cuenta local: genérico y con verificación", async () => {
    await expect(login("EMPRESA\\activo", "correcta-123")).rejects.toMatchObject({ status: 401 });
    expect(pwd.calls).toBe(1);
  });

  it("credenciales correctas siguen entrando", async () => {
    await expect(login("activo", "correcta-123")).resolves.toMatchObject({ username: "activo" });
  });
});
