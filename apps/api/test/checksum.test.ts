import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareChecksums, hashFile, md5Base64ToHex } from "../src/modules/backups/engine/checksum.js";

describe("hashFile", () => {
  let dir = "";
  afterAll(() => (dir ? rm(dir, { recursive: true, force: true }) : undefined));

  it("calcula SHA-256 y MD5 (hex) y CRC32C (base64, formato GCS) del contenido", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "dbk-hash-"));
    const file = path.join(dir, "a.sql");
    await writeFile(file, "hello world");
    await expect(hashFile(file)).resolves.toEqual({
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      md5: "5eb63bbbe01eeed093cb22bb8f5acdc3",
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

describe("compareChecksums", () => {
  const expected = { sha256: "aa", md5: "bb", crc32c: "cc" };

  it("coincide si todos los hashes comparables son iguales", () => {
    expect(compareChecksums(expected, { md5: "bb", crc32c: "cc" })).toEqual({ compared: 2, diffs: [] });
  });

  it("reporta cada hash que difiere", () => {
    const r = compareChecksums(expected, { sha256: "xx", md5: "bb", crc32c: "zz" });
    expect(r.compared).toBe(3);
    expect(r.diffs).toEqual(["SHA-256: esperado aa, actual xx", "CRC32C: esperado cc, actual zz"]);
  });

  it("no compara hashes ausentes en alguno de los lados", () => {
    expect(compareChecksums({ sha256: "aa", md5: null, crc32c: null }, { md5: "bb", crc32c: "cc" })).toEqual({
      compared: 0,
      diffs: [],
    });
  });
});
