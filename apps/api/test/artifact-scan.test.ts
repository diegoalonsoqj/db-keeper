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

import { reconcile } from "../src/modules/artifacts/scans.service.js";

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
