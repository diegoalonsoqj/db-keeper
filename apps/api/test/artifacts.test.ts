import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const repo = vi.hoisted(() => ({ listArtifacts: vi.fn(), listRunnerHosts: vi.fn() }));
const storage = vi.hoisted(() => ({ listLocalRoots: vi.fn(), listBucketRoots: vi.fn() }));
vi.mock("../src/modules/artifacts/artifacts.repository.js", () => repo);
vi.mock("../src/modules/storage/storage.repository.js", () => storage);

import { listArtifacts, locate, locateObject } from "../src/modules/artifacts/artifacts.service.js";
import { BACKUP_ROOT } from "../src/modules/backups/engine/files.js";

const base = path.resolve("/srv/bk");
const roots = [
  { name: "General", abs: base },
  { name: "Postgres", abs: path.join(base, "postgres") },
];

describe("locate", () => {
  it("usa el destino más específico y devuelve ruta relativa con /", () => {
    const r = locate(path.join(base, "postgres", "srv1", "a.dump"), roots);
    expect(r).toEqual({ storageName: "Postgres", relativePath: "srv1/a.dump" });
  });

  it("fuera de todo destino solo expone el nombre del archivo", () => {
    const r = locate(path.resolve("/otra/ruta/secreta/b.dump"), roots);
    expect(r).toEqual({ storageName: null, relativePath: "b.dump" });
  });

  it("un prefijo de nombre no cuenta como contenido (/srv/bk2 no está en /srv/bk)", () => {
    expect(locate(path.resolve("/srv/bk2/c.dump"), roots).storageName).toBeNull();
  });

  it("ruta relativa heredada con traversal: no escapa y solo devuelve el nombre", () => {
    expect(locate("../../etc/passwd", roots)).toEqual({ storageName: null, relativePath: "passwd" });
  });
});

describe("listArtifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.listLocalRoots.mockResolvedValue([{ name: "General", path: base }]);
    storage.listBucketRoots.mockResolvedValue([]);
  });

  it("no devuelve la ruta absoluta guardada", async () => {
    repo.listArtifacts.mockResolvedValue({
      total: 1,
      items: [{ itemId: "i1", executionId: "e1", kind: "file", fileName: path.join(base, "x", "d.dump"), dbName: "d" }],
    });
    const res = await listArtifacts({ limit: 10, offset: 0 });
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ storageName: "General", relativePath: "x/d.dump" });
    expect(res.items[0]).not.toHaveProperty("fileName");
  });

  it("si un destino tiene la misma ruta que BACKUP_DIR, se muestra su nombre", async () => {
    repo.listArtifacts.mockResolvedValue({ total: 1, items: [{ kind: "file", fileName: path.join(BACKUP_ROOT, "f.dump") }] });
    storage.listLocalRoots.mockResolvedValue([{ name: "Local por defecto", path: BACKUP_ROOT }]);
    const res = await listArtifacts({ limit: 10, offset: 0 });
    expect(res.items[0]).toMatchObject({ storageName: "Local por defecto", relativePath: "f.dump" });
  });

  it("los registros relativos heredados se ubican bajo BACKUP_DIR", async () => {
    repo.listArtifacts.mockResolvedValue({ total: 1, items: [{ kind: "file", fileName: "postgres/e.dump" }] });
    storage.listLocalRoots.mockResolvedValue([]);
    const res = await listArtifacts({ limit: 10, offset: 0 });
    expect(res.items[0]).toMatchObject({ storageName: null, relativePath: "postgres/e.dump" });
    expect(BACKUP_ROOT).toBeTruthy();
  });
});

describe("locateObject", () => {
  const buckets = [
    { name: "PRD", bucket: "b", prefix: "dbk", cloudCredentialId: null, isActive: true },
    { name: "PRD-SQL", bucket: "b", prefix: "dbk/sql/", cloudCredentialId: null, isActive: true },
  ];

  it("usa el prefijo más específico y no expone el bucket", () => {
    expect(locateObject("gs://b/dbk/sql/s1/a.bak", buckets)).toEqual({ storageName: "PRD-SQL", relativePath: "s1/a.bak" });
    expect(locateObject("gs://b/dbk/pg/a.sql.gz", buckets)).toEqual({ storageName: "PRD", relativePath: "pg/a.sql.gz" });
  });

  it("un prefijo de nombre no cuenta (dbk2 no está en dbk)", () => {
    expect(locateObject("gs://b/dbk2/a.dump", buckets)).toEqual({ storageName: null, relativePath: "a.dump" });
  });

  it("bucket no registrado: solo el nombre; las carpetas conservan la barra final", () => {
    expect(locateObject("gs://secreto/x/y/db_1/", buckets)).toEqual({ storageName: null, relativePath: "db_1/" });
  });
});
