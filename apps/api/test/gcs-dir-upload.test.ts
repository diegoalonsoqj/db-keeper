import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Los módulos del motor leen la config al importarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

/** Cómo se comporta la escritura de cada objeto en el bucket simulado. */
const bucketMode = vi.hoisted(() => ({ value: "ok" as "ok" | "hang" }));

vi.mock("../src/modules/backups/engine/gcs.js", async () => {
  const { CRC32C } = await import("@google-cloud/storage");
  const objects = new Map<string, Buffer>();
  const meta = (buf: Buffer): { size: string; crc32c: string } => {
    const crc = new CRC32C();
    crc.update(buf);
    return { size: String(buf.length), crc32c: crc.toString() };
  };
  const bucket = {
    file: (name: string) => ({
      createWriteStream: () => {
        const chunks: Buffer[] = [];
        return new Writable({
          write(chunk: Buffer, _enc, cb) {
            chunks.push(chunk);
            // "hang": la petición nunca responde (sin error ni avance).
            if (bucketMode.value === "ok") cb();
          },
          final(cb) {
            objects.set(name, Buffer.concat(chunks));
            cb();
          },
        });
      },
      save: async (buf: Buffer) => void objects.set(name, buf),
      getMetadata: async () => [meta(objects.get(name)!)],
    }),
    getFiles: async ({ prefix }: { prefix: string }) => [
      [...objects].filter(([n]) => n.startsWith(prefix)).map(([n, b]) => ({ name: n, metadata: meta(b) })),
    ],
  };
  return { gcsClient: () => ({ bucket: () => bucket }) };
});

import { uploadDirectoryToGcs } from "../src/modules/backups/engine/gcs-dir.js";

let dir: string;
const auth = { bucket: "b", serviceAccountJson: null };

beforeEach(async () => {
  bucketMode.value = "ok";
  dir = await mkdtemp(path.join(tmpdir(), "dbk-upload-"));
  await writeFile(path.join(dir, "toc.dat"), "toc");
  await writeFile(path.join(dir, "3001.dat.gz"), Buffer.alloc(200_000, 7));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("uploadDirectoryToGcs", () => {
  it("sube, verifica y deja el manifiesto", async () => {
    const up = await uploadDirectoryToGcs(auth, dir, "p/ok", { concurrency: 2, manifestExtra: {}, inactivityMs: 5_000 });
    expect(up.uri).toBe("gs://b/p/ok/");
    expect(up.files).toBe(2);
    expect(up.bytes).toBe(200_003);
  });

  it("aborta una subida estancada (sin bytes durante inactivityMs)", async () => {
    bucketMode.value = "hang";
    await expect(
      uploadDirectoryToGcs(auth, dir, "p/hang", { concurrency: 2, manifestExtra: {}, inactivityMs: 100 }),
    ).rejects.toThrow(/Subida detenida/);
  });

  it("la cancelación manda sobre el estancamiento", async () => {
    bucketMode.value = "hang";
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    await expect(
      uploadDirectoryToGcs(auth, dir, "p/cancel", { concurrency: 2, manifestExtra: {}, signal: ac.signal, inactivityMs: 10_000 }),
    ).rejects.toThrow("Cancelada");
  });

  it("sin inactivityMs no hay vigilante (comportamiento anterior)", async () => {
    const up = await uploadDirectoryToGcs(auth, dir, "p/nolimit", { concurrency: 1, manifestExtra: {} });
    expect(up.files).toBe(2);
  });
});
