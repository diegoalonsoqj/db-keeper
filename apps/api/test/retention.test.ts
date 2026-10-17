import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const repo = vi.hoisted(() => ({
  findJobById: vi.fn(),
  findPrunableItems: vi.fn(),
  markItemPruned: vi.fn(),
  listJobIdsWithRetention: vi.fn(),
}));
const servers = vi.hoisted(() => ({ findById: vi.fn() }));
const settings = vi.hoisted(() => ({ getBackupSettings: vi.fn() }));
const fs = vi.hoisted(() => ({ rm: vi.fn() }));

vi.mock("../src/modules/backups/backups.repository.js", () => repo);
vi.mock("../src/modules/servers/servers.repository.js", () => servers);
vi.mock("../src/modules/settings/settings.service.js", () => settings);
vi.mock("node:fs/promises", () => fs);

import { effectivePolicy, enforceRetentionForJob, sweepRetention } from "../src/modules/backups/retention.js";

const job = (over: Record<string, unknown> = {}) => ({ id: "j1", name: "BK", serverId: "s1", method: "dump", options: {}, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  settings.getBackupSettings.mockResolvedValue({ defaultKeepLast: 0 });
  servers.findById.mockResolvedValue({ engine: "postgres" });
  repo.findPrunableItems.mockResolvedValue([{ id: "i1", fileName: "/backups/postgres/x/a.dump" }]);
  fs.rm.mockResolvedValue(undefined);
});

describe("effectivePolicy", () => {
  it("la retención propia del evento manda sobre la por defecto", () => {
    expect(effectivePolicy({ retention: { days: 7 } }, 3)).toEqual({ days: 7, keepLast: null });
  });
  it("sin retención propia usa la por defecto", () => {
    expect(effectivePolicy({}, 2)).toEqual({ days: null, keepLast: 2 });
  });
  it("por defecto 0 = sin retención", () => {
    expect(effectivePolicy({}, 0)).toEqual({ days: null, keepLast: null });
  });
});

describe("enforceRetentionForJob", () => {
  it("evento local: purga el archivo del backup", async () => {
    repo.findJobById.mockResolvedValue(job({ options: { retention: { keepLast: 2 } } }));
    await enforceRetentionForJob("j1");
    expect(repo.findPrunableItems).toHaveBeenCalledWith("j1", { days: null, keepLast: 2 }, "file");
    expect(fs.rm).toHaveBeenCalledWith("/backups/postgres/x/a.dump", { force: true });
    expect(repo.markItemPruned).toHaveBeenCalledWith("i1", "file");
  });

  it("evento a bucket con copia local: purga solo la copia en disco", async () => {
    repo.findJobById.mockResolvedValue(job({ method: "gcloud", options: { keepLocalCopy: true } }));
    settings.getBackupSettings.mockResolvedValue({ defaultKeepLast: 2 });
    await enforceRetentionForJob("j1");
    expect(repo.findPrunableItems).toHaveBeenCalledWith("j1", { days: null, keepLast: 2 }, "local");
    expect(repo.markItemPruned).toHaveBeenCalledWith("i1", "local");
  });

  it("nunca borra un objeto de bucket", async () => {
    repo.findJobById.mockResolvedValue(job({ options: { retention: { keepLast: 1 } } }));
    repo.findPrunableItems.mockResolvedValue([{ id: "i1", fileName: "gs://b/x.dump" }]);
    await enforceRetentionForJob("j1");
    expect(fs.rm).not.toHaveBeenCalled();
    expect(repo.markItemPruned).not.toHaveBeenCalled();
  });

  it.each([
    ["export de Cloud SQL", job({ method: "cloudsql_export" }), "postgres"],
    ["SQL Server nativo", job(), "sqlserver"],
  ])("no toca %s", async (_l, j, engine) => {
    repo.findJobById.mockResolvedValue({ ...j, options: { retention: { keepLast: 1 } } });
    servers.findById.mockResolvedValue({ engine });
    await enforceRetentionForJob("j1");
    expect(repo.findPrunableItems).not.toHaveBeenCalled();
  });

  it("sin retención propia ni por defecto no hace nada", async () => {
    repo.findJobById.mockResolvedValue(job());
    await enforceRetentionForJob("j1");
    expect(repo.findPrunableItems).not.toHaveBeenCalled();
  });
});

describe("sweepRetention", () => {
  it("con retención por defecto incluye todos los eventos con archivos en disco", async () => {
    settings.getBackupSettings.mockResolvedValue({ defaultKeepLast: 3 });
    repo.listJobIdsWithRetention.mockResolvedValue([]);
    await sweepRetention();
    expect(repo.listJobIdsWithRetention).toHaveBeenCalledWith(true);
  });
  it("sin ella, solo los que tienen regla propia", async () => {
    repo.listJobIdsWithRetention.mockResolvedValue([]);
    await sweepRetention();
    expect(repo.listJobIdsWithRetention).toHaveBeenCalledWith(false);
  });
});
