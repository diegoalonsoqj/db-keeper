import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hashFile, md5Base64ToHex } from "../src/modules/backups/engine/checksum.js";

describe("hashFile", () => {
  let dir = "";
  afterAll(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  it("calcula SHA-256 (hex) y CRC32C (base64, formato GCS) del contenido", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dbk-hash-"));
    const file = path.join(dir, "a.sql");
    await writeFile(file, "hello world");
    await expect(hashFile(file)).resolves.toEqual({
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      crc32c: "yZRlqg==",
    });
  });
});

describe("md5Base64ToHex", () => {
  it("convierte el md5Hash de GCS al hex de md5sum", () => {
    expect(md5Base64ToHex("XrY7u+Ae7tCTyyK7j1rNww==")).toBe("5eb63bbbe01eeed093cb22bb8f5acdc3");
    expect(md5Base64ToHex(null)).toBeNull();
  });
});
