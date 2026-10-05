import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { pgCompatFilter } from "../src/modules/backups/engine/pg-compat.js";

/** Pasa `input` por el filtro en trozos de `chunk` bytes y devuelve la salida. */
async function filter(input: string, chunk = 64 * 1024): Promise<string> {
  const buf = Buffer.from(input);
  const parts: Buffer[] = [];
  for (let i = 0; i < buf.length; i += chunk) parts.push(buf.subarray(i, i + chunk));
  const out: Buffer[] = [];
  await pipeline(
    Readable.from(parts),
    pgCompatFilter(),
    new Writable({
      write(c: Buffer, _e, cb) {
        out.push(c);
        cb();
      },
    }),
  );
  return Buffer.concat(out).toString();
}

const big = "x".repeat(1_000_000);
const input = [
  "--",
  "\\restrict AbC123xyz",
  "SET statement_timeout = 0;",
  "SET transaction_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "COPY public.t (a) FROM stdin;",
  "SET transaction_timeout = 0;", // dato dentro del COPY: no se toca
  "\\restrict ZZZ",
  big,
  "\\.",
  "SET transaction_timeout = 5;", // valor distinto: no se toca
  "\\unrestrict AbC123xyz",
  "",
].join("\n");
const expected = [
  "--",
  "SET statement_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "COPY public.t (a) FROM stdin;",
  "SET transaction_timeout = 0;",
  "\\restrict ZZZ",
  big,
  "\\.",
  "SET transaction_timeout = 5;",
  "",
].join("\n");

describe("pgCompatFilter", () => {
  it.each([1, 7, 31, 32, 33, 64 * 1024])("quita solo las líneas incompatibles (trozos de %i bytes)", async (chunk) => {
    expect(await filter(input, chunk)).toBe(expected);
  });

  it("filtra también la última línea sin salto final", async () => {
    expect(await filter("SELECT 1;\n\\unrestrict K9")).toBe("SELECT 1;\n");
  });
});
