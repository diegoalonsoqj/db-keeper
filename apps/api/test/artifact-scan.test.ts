import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

vi.mock("../src/modules/artifacts/scans.repository.js", () => ({ listLatestScans: vi.fn(), listFindings: vi.fn() }));
vi.mock("../src/modules/artifacts/artifacts.repository.js", () => ({}));
vi.mock("../src/modules/storage/storage.repository.js", () => ({}));

import { reconcile, reconcileGcs, type BucketTarget } from "../src/modules/artifacts/scans.service.js";

const HOUR = 3_600_000;
const now = new Date();
let dir: string;

/** Crea un archivo con fecha de modificación de hace `ageMs`. */
async function file(rel: string, ageMs = 5 * HOUR): Promise<string> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, "x");
  const t = new Date(now.getTime() - ageMs);
  await utimes(abs, t, t);
  return abs;
}

const reg = (fileName: string, over: Record<string, unknown> = {}) => ({
  itemId: "i-" + path.basename(fileName),
  kind: "file" as "file" | "copy" | "object",
  executionId: "e1",
  fileName,
  pruned: false,
  runnerHost: "h1",
  ...over,
});

const run = (registered: ReturnType<typeof reg>[], over: Record<string, unknown> = {}) =>
  reconcile({
    roots: [{ name: "Local", abs: dir }],
    registered,
    host: "h1",
    now,
    graceMs: 2 * HOUR,
    maxFiles: 1000,
    ...over,
  });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dbk-scan-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("reconcile", () => {
  it("clasifica huérfanos, faltantes y purgados presentes", async () => {
    const ok = await file("pg/ok.sql.gz");
    await file("pg/huerfano.sql.gz");
    const stale = await file("pg/purgado.sql.gz");
    const res = await run([reg(ok), reg(stale, { pruned: true }), reg(path.join(dir, "pg/borrado.sql.gz"))]);

    const byKind = Object.fromEntries(res.findings.map((f) => [f.kind, f]));
    expect(res.findings).toHaveLength(3);
    expect(byKind.orphan).toMatchObject({ storageName: "Local", relativePath: "pg/huerfano.sql.gz", itemId: null });
    expect(byKind.stale).toMatchObject({ relativePath: "pg/purgado.sql.gz", itemId: "i-purgado.sql.gz" });
    expect(byKind.missing).toMatchObject({ relativePath: "pg/borrado.sql.gz", fileBytes: null });
    expect(res.filesScanned).toBe(3);
    expect(res.truncated).toBe(false);
  });

  it("ignora archivos recientes (posibles dumps en curso)", async () => {
    await file("pg/en-curso.sql.gz", 10 * 60_000);
    expect((await run([])).findings).toEqual([]);
  });

  it("los faltantes de otro host no cuentan (su disco es otro); los heredados sin host sí", async () => {
    const otro = path.join(dir, "otro.sql.gz");
    const legado = path.join(dir, "legado.sql.gz");
    const res = await run([reg(otro, { runnerHost: "h2" }), reg(legado, { runnerHost: null })]);
    expect(res.findings.map((f) => f.relativePath)).toEqual(["legado.sql.gz"]);
  });

  it("no sigue symlinks (no sale del destino)", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "dbk-out-"));
    try {
      await writeFile(path.join(outside, "secreto.txt"), "x");
      try {
        await symlink(outside, path.join(dir, "enlace"), "junction");
      } catch {
        return; // sin permiso para crear enlaces en este sistema
      }
      const res = await run([]);
      expect(res.findings).toEqual([]);
      expect(res.filesScanned).toBe(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("corta en el tope de archivos y lo marca como parcial", async () => {
    for (const n of ["a", "b", "c"]) await file(`${n}.dump`);
    const res = await run([], { maxFiles: 2 });
    expect(res.filesScanned).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it("corta en el tope de hallazgos", async () => {
    for (const n of ["a", "b", "c"]) await file(`${n}.dump`);
    const res = await run([], { maxFindings: 1 });
    expect(res.findings).toHaveLength(1);
    expect(res.truncated).toBe(true);
  });

  it("informa los destinos que no existen en el host, por nombre", async () => {
    const res = await run([], { roots: [{ name: "Local", abs: dir }, { name: "NAS", abs: path.join(dir, "..", "no-existe-xyz") }] });
    expect(res.detail).toEqual({ scanned: 1, missing: ["NAS"] });
  });

  it("un destino dentro de otro se recorre una sola vez", async () => {
    await file("sub/a.dump");
    const res = await run([], { roots: [{ name: "Local", abs: dir }, { name: "Sub", abs: path.join(dir, "sub") }] });
    expect(res.filesScanned).toBe(1);
    expect(res.findings[0]).toMatchObject({ storageName: "Sub", relativePath: "a.dump" });
  });
});

describe("reconcile (local) ignora los objetos de bucket", () => {
  it("una URI gs:// no se trata como ruta local faltante", async () => {
    const res = await run([reg("gs://b/pg/x.sql.gz", { kind: "object" })]);
    expect(res.findings).toEqual([]);
  });
});

describe("reconcileGcs", () => {
  const target = (over: Partial<BucketTarget> = {}): BucketTarget => ({
    name: "Bucket PRD",
    bucket: "b",
    prefix: "dbk",
    cloudCredentialId: null,
    isActive: true,
    serviceAccountJson: null,
    ...over,
  });
  const old = new Date(now.getTime() - 5 * HOUR);
  const obj = (name: string, updated = old) => ({ name, bytes: 10, updated });
  const greg = (uri: string) => reg(uri, { kind: "object" });

  /** Listador falso: devuelve los objetos en páginas de `pageSize`. */
  function lister(objects: ReturnType<typeof obj>[], pageSize = 1000) {
    const calls: string[] = [];
    const fn = async (_t: BucketTarget, prefix: string, token?: string) => {
      calls.push(prefix);
      const all = objects.filter((o) => o.name.startsWith(prefix));
      const start = Number(token ?? 0);
      const next = start + pageSize < all.length ? String(start + pageSize) : undefined;
      return { objects: all.slice(start, start + pageSize), nextPageToken: next };
    };
    return { fn, calls };
  }

  const runGcs = (registered: ReturnType<typeof reg>[], objects: ReturnType<typeof obj>[], over: Record<string, unknown> = {}) => {
    const l = lister(objects, (over.pageSize as number) ?? 1000);
    return reconcileGcs({
      targets: [target()],
      registered,
      now,
      graceMs: 2 * HOUR,
      maxObjects: 1000,
      listPage: l.fn,
      ...over,
    });
  };

  it("huérfanos y faltantes, con ruta relativa al prefijo y sin nombre de bucket", async () => {
    const res = await runGcs(
      [greg("gs://b/dbk/srv/ok.sql.gz"), greg("gs://b/dbk/srv/borrado.sql.gz")],
      [obj("dbk/srv/ok.sql.gz"), obj("dbk/srv/suelto.sql.gz")],
    );
    expect(res.findings).toEqual([
      expect.objectContaining({ kind: "orphan", storageName: "Bucket PRD", relativePath: "srv/suelto.sql.gz", fileBytes: 10 }),
      expect.objectContaining({ kind: "missing", storageName: "Bucket PRD", relativePath: "srv/borrado.sql.gz" }),
    ]);
    expect(JSON.stringify(res.findings)).not.toContain("gs://");
  });

  it("los objetos dentro de una carpeta registrada (dump paralelo) no son huérfanos", async () => {
    const res = await runGcs([greg("gs://b/dbk/srv/db_20261022/")], [obj("dbk/srv/db_20261022/manifest.json"), obj("dbk/srv/db_20261022/3001.dat.gz")]);
    expect(res.findings).toEqual([]);
  });

  it("una carpeta registrada sin objetos es faltante", async () => {
    const res = await runGcs([greg("gs://b/dbk/srv/db_vacia/")], []);
    expect(res.findings).toEqual([expect.objectContaining({ kind: "missing", relativePath: "srv/db_vacia/" })]);
  });

  it("ignora objetos recientes (subidas o exports en curso)", async () => {
    const res = await runGcs([], [obj("dbk/nuevo.bak", new Date(now.getTime() - 60_000))]);
    expect(res.findings).toEqual([]);
  });

  it("recorre todas las páginas", async () => {
    const objects = ["a", "b", "c", "d", "e"].map((n) => obj(`dbk/${n}.dump`));
    const res = await runGcs([], objects, { pageSize: 2 });
    expect(res.filesScanned).toBe(5);
    expect(res.findings).toHaveLength(5);
    expect(res.truncated).toBe(false);
  });

  it("con el listado cortado por el tope no informa faltantes (no se puede afirmar)", async () => {
    const objects = ["a", "b", "c"].map((n) => obj(`dbk/${n}.dump`));
    const res = await runGcs([greg("gs://b/dbk/z.dump")], objects, { pageSize: 2, maxObjects: 2 });
    expect(res.truncated).toBe(true);
    expect(res.findings.some((f) => f.kind === "missing")).toBe(false);
  });

  it("un bucket inaccesible se informa por nombre y sus registrados no salen como faltantes", async () => {
    const res = await reconcileGcs({
      targets: [target()],
      registered: [greg("gs://b/dbk/x.dump")],
      now,
      graceMs: 0,
      maxObjects: 1000,
      listPage: async () => {
        throw new Error("403 Forbidden");
      },
    });
    expect(res.findings).toEqual([]);
    expect(res.detail).toEqual({ scanned: 0, missing: ["Bucket PRD"] });
  });

  it("un destino con prefijo dentro de otro del mismo bucket se lista una sola vez", async () => {
    const l = lister([obj("dbk/sub/a.dump")]);
    await reconcileGcs({
      targets: [target(), target({ name: "Sub", prefix: "/dbk/sub/" })],
      registered: [],
      now,
      graceMs: 0,
      maxObjects: 1000,
      listPage: l.fn,
    });
    expect(l.calls).toEqual(["dbk/"]);
  });

  it("los registrados de buckets que no son destinos no se informan", async () => {
    const res = await runGcs([greg("gs://otro/dbk/x.dump")], []);
    expect(res.findings).toEqual([]);
  });
});
