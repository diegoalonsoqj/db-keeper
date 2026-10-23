import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

const gcs = vi.hoisted(() => ({ uploadToGcs: vi.fn() }));
vi.mock("../src/modules/backups/engine/gcs.js", () => gcs);

import { createFullLog } from "../src/modules/backups/engine/full-log.js";

const auth = { bucket: "b", serviceAccountJson: null };
let dir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dir = await mkdtemp(path.join(tmpdir(), "dbk-fulllog-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("createFullLog", () => {
  it("local: guarda todas las líneas y devuelve ruta, tamaño y SHA-256", async () => {
    const p = path.join(dir, "db_1.log");
    const log = createFullLog(p);
    for (let i = 0; i < 5000; i++) log.write(`10:00:00 línea ${i}`);
    const ref = await log.save({ kind: "local" });
    const text = await readFile(p, "utf8");
    expect(text.split("\n")).toHaveLength(5001); // 5000 líneas + salto final
    expect(ref).toEqual({ file: p, bytes: Buffer.byteLength(text), sha256: sha(text) });
  });

  it("bucket: sube con su SHA-256 y borra la copia local", async () => {
    gcs.uploadToGcs.mockResolvedValue("gs://b/pre/db_1.log");
    const p = path.join(dir, "db_1.log");
    const log = createFullLog(p);
    log.write("a");
    const ref = await log.save({ kind: "gcs", auth, objectName: "pre/db_1.log" });
    expect(gcs.uploadToGcs).toHaveBeenCalledWith(auth, p, "pre/db_1.log", { sha256: sha("a\n") });
    expect(ref).toEqual({ file: "gs://b/pre/db_1.log", bytes: 2, sha256: sha("a\n") });
    expect(await exists(p)).toBe(false);
  });

  it("si la subida falla, el log queda en disco y se registra esa ruta", async () => {
    gcs.uploadToGcs.mockRejectedValue(new Error("403"));
    const p = path.join(dir, "db_1.log");
    const log = createFullLog(p);
    log.write("a");
    const ref = await log.save({ kind: "gcs", auth, objectName: "pre/db_1.log" });
    expect(ref?.file).toBe(p);
    expect(await exists(p)).toBe(true);
  });

  it("si no se puede escribir, devuelve null sin lanzar", async () => {
    const log = createFullLog(path.join(dir, "no-existe", "db_1.log"));
    log.write("a");
    await expect(log.save({ kind: "local" })).resolves.toBeNull();
  });
});
