import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const fs = vi.hoisted(() => ({ statfs: vi.fn() }));
const settings = vi.hoisted(() => ({ getBackupSettings: vi.fn() }));
const notif = vi.hoisted(() => ({ notifyDiskLow: vi.fn() }));

vi.mock("node:fs/promises", () => fs);
vi.mock("../src/modules/settings/settings.service.js", () => settings);
vi.mock("../src/modules/notifications/notifications.service.js", () => notif);
vi.mock("../src/modules/backups/engine/runner.js", () => ({ resolveLocalRoot: vi.fn().mockResolvedValue("/backups") }));

import { checkBackupDisk } from "../src/modules/backups/disk-watch.js";

/** Disco de 100 bloques de 1 KiB con `free` bloques disponibles. */
const disk = (free: number) => ({ blocks: 100, bsize: 1024, bavail: free });

beforeEach(() => {
  vi.clearAllMocks();
  settings.getBackupSettings.mockResolvedValue({ diskFreeAlertPercent: 10 });
});

// Orden importa: el estado "ya avisado" vive en el módulo.
describe("checkBackupDisk", () => {
  it("con espacio suficiente no avisa", async () => {
    fs.statfs.mockResolvedValue(disk(50));
    await checkBackupDisk();
    expect(notif.notifyDiskLow).not.toHaveBeenCalled();
  });

  it("bajo el umbral avisa una sola vez", async () => {
    fs.statfs.mockResolvedValue(disk(5));
    await checkBackupDisk();
    await checkBackupDisk();
    expect(notif.notifyDiskLow).toHaveBeenCalledOnce();
    expect(notif.notifyDiskLow).toHaveBeenCalledWith(expect.objectContaining({ path: "/backups", freePct: 5 }), 10);
  });

  it("no se rearma justo en el umbral (margen), sí al recuperarse", async () => {
    fs.statfs.mockResolvedValue(disk(11)); // 11 % < 10 + 2
    await checkBackupDisk();
    fs.statfs.mockResolvedValue(disk(5));
    await checkBackupDisk();
    expect(notif.notifyDiskLow).not.toHaveBeenCalled();

    fs.statfs.mockResolvedValue(disk(20)); // recuperado
    await checkBackupDisk();
    fs.statfs.mockResolvedValue(disk(5));
    await checkBackupDisk();
    expect(notif.notifyDiskLow).toHaveBeenCalledOnce();
  });

  it("0 = desactivado; ruta inexistente no falla", async () => {
    settings.getBackupSettings.mockResolvedValue({ diskFreeAlertPercent: 0 });
    await checkBackupDisk();
    expect(fs.statfs).not.toHaveBeenCalled();

    settings.getBackupSettings.mockResolvedValue({ diskFreeAlertPercent: 10 });
    fs.statfs.mockRejectedValue(Object.assign(new Error("no"), { code: "ENOENT" }));
    await expect(checkBackupDisk()).resolves.toBeUndefined();
  });
});
