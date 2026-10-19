import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthIdentity } from "@dbkeeper/shared";

// Credenciales: c-admin (contraseña puesta por un admin), c-own (por el editor),
// c-legacy (anterior a registrar quién la puso). La instancia s1 usa c-admin.
const setBy: Record<string, string | null> = { "c-admin": "admin-id", "c-own": "editor-id", "c-legacy": null };
const links = new Set(["c-admin@s1"]);

vi.mock("../src/modules/credentials/credentials.repository.js", () => ({
  getPasswordSetBy: vi.fn(async (id: string) => setBy[id] ?? null),
  isLinkedToServer: vi.fn(async (cred: string, server: string) => links.has(`${cred}@${server}`)),
}));

import { assertCanRetarget, assertCanUseCredential } from "../src/modules/credentials/credential-guard.js";

const identity = (id: string, permissions: string[]) => ({ user: { id }, permissions }) as unknown as AuthIdentity;
const editor = identity("editor-id", ["servers:read", "servers:write"]);
const admin = identity("admin-id", ["servers:read", "servers:write", "credentials:use"]);

beforeEach(() => vi.clearAllMocks());

describe("assertCanUseCredential", () => {
  it("sin credencial no hay nada que validar", async () => {
    await expect(assertCanUseCredential(editor, null, null)).resolves.toBeUndefined();
  });

  it("con credentials:use se permite cualquier combinación", async () => {
    await expect(assertCanUseCredential(admin, "c-legacy", null)).resolves.toBeUndefined();
  });

  it("la combinación que ya existe sigue valiendo para el editor", async () => {
    await expect(assertCanUseCredential(editor, "c-admin", "s1")).resolves.toBeUndefined();
  });

  it("el editor usa libremente la credencial cuya contraseña escribió", async () => {
    await expect(assertCanUseCredential(editor, "c-own", null)).resolves.toBeUndefined();
    await expect(assertCanUseCredential(editor, "c-own", "s2")).resolves.toBeUndefined();
  });

  it("el editor no puede llevar una credencial ajena a una instancia nueva u otra", async () => {
    await expect(assertCanUseCredential(editor, "c-admin", null)).rejects.toMatchObject({ status: 403 });
    await expect(assertCanUseCredential(editor, "c-admin", "s2")).rejects.toMatchObject({ status: 403 });
    await expect(assertCanUseCredential(editor, "c-legacy", "s1")).rejects.toMatchObject({ status: 403 });
  });
});

describe("assertCanRetarget", () => {
  it("con credentials:use se puede cambiar el destino", async () => {
    await expect(assertCanRetarget(admin, ["c-admin", "c-legacy"])).resolves.toBeUndefined();
  });

  it("instancia sin credenciales o solo con las propias: se permite", async () => {
    await expect(assertCanRetarget(editor, [null])).resolves.toBeUndefined();
    await expect(assertCanRetarget(editor, ["c-own", null])).resolves.toBeUndefined();
  });

  it("si alguna credencial es ajena, se rechaza", async () => {
    await expect(assertCanRetarget(editor, ["c-own", "c-admin"])).rejects.toMatchObject({ status: 403 });
  });
});
