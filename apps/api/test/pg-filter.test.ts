import { readFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { parseIdentifier, pgDumpFilter, type PgDumpFilterOptions } from "../src/modules/backups/engine/pg-filter.js";

/** Pasa `input` por el filtro en trozos de `chunk` bytes; devuelve la salida y los triggers quitados. */
async function filter(input: string, opts: PgDumpFilterOptions, chunk = 64 * 1024) {
  const buf = Buffer.from(input);
  const parts: Buffer[] = [];
  for (let i = 0; i < buf.length; i += chunk) parts.push(buf.subarray(i, i + chunk));
  const out: Buffer[] = [];
  const f = pgDumpFilter(opts);
  await pipeline(
    Readable.from(parts),
    f,
    new Writable({
      write(c: Buffer, _e, cb) {
        out.push(c);
        cb();
      },
    }),
  );
  return { text: Buffer.concat(out).toString(), dropped: [...f.droppedEventTriggers].sort() };
}

const CHUNKS = [1, 7, 31, 32, 33, 64 * 1024];

describe("pgDumpFilter · compat", () => {
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

  it.each(CHUNKS)("quita solo las líneas incompatibles (trozos de %i bytes)", async (chunk) => {
    expect((await filter(input, { compat: true }, chunk)).text).toBe(expected);
  });

  it("filtra también la última línea sin salto final", async () => {
    expect((await filter("SELECT 1;\n\\unrestrict K9", { compat: true })).text).toBe("SELECT 1;\n");
  });

  it("sin compat no quita nada", async () => {
    expect((await filter(input, {})).text).toBe(input);
  });
});

describe("pgDumpFilter · event triggers", () => {
  // Dump real de pg_dump: un trigger con WHEN TAG en 3 líneas y un COMMENT con `;` y
  // salto de línea; otro con nombre entre comillas que contiene `;`, deshabilitado
  // (CREATE + ALTER … DISABLE); y un COPY cuyo dato es `CREATE EVENT TRIGGER …`.
  const dump = readFileSync(new URL("./fixtures/event-triggers.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it.each(CHUNKS)("quita CREATE y COMMENT del trigger excluido (trozos de %i bytes)", async (chunk) => {
    const { text, dropped } = await filter(dump, { excludeEventTriggers: ["trg_ddl_command_end_events"] }, chunk);
    expect(dropped).toEqual(["trg_ddl_command_end_events"]);
    expect(text).not.toContain("CREATE EVENT TRIGGER trg_ddl_command_end_events ON ddl_command_end");
    expect(text).not.toMatch(/WHEN TAG IN/);
    expect(text).not.toMatch(/COMMENT ON EVENT TRIGGER|en dos líneas/);
    // El no excluido se mantiene completo.
    expect(text).toContain('CREATE EVENT TRIGGER "Trg Raro;x" ON ddl_command_start\n   EXECUTE FUNCTION public.log_ddl();\n');
    expect(text).toContain('ALTER EVENT TRIGGER "Trg Raro;x" DISABLE;\n');
    // La función RETURNS event_trigger y el dato del COPY no se tocan.
    expect(text).toContain("CREATE FUNCTION public.log_ddl() RETURNS event_trigger");
    expect(text).toContain("COPY public.t (a) FROM stdin;\nCREATE EVENT TRIGGER trg_ddl_command_end_events ON x;\n\\.\n");
  });

  it.each(CHUNKS)("quita CREATE y ALTER de un nombre entre comillas con `;` (trozos de %i bytes)", async (chunk) => {
    const { text, dropped } = await filter(dump, { excludeEventTriggers: ["Trg Raro;x"] }, chunk);
    expect(dropped).toEqual(["Trg Raro;x"]);
    expect(text).not.toContain('"Trg Raro;x" ON');
    expect(text).not.toContain("DISABLE");
    expect(text).toContain("CREATE EVENT TRIGGER trg_ddl_command_end_events ON ddl_command_end");
    expect(text).toContain("COMMENT ON EVENT TRIGGER trg_ddl_command_end_events IS 'audita; DDL\nen dos líneas';");
  });

  it("solo con los triggers del dump: el resto del archivo queda idéntico", async () => {
    const { text } = await filter(dump, { excludeEventTriggers: ["trg_ddl_command_end_events", "Trg Raro;x"] });
    const strip = (s: string) => s.replace(/^(CREATE|ALTER|COMMENT ON) EVENT TRIGGER[\s\S]*?;\n/gm, "");
    // Quitando a mano las mismas sentencias (fuera del COPY) se obtiene lo mismo.
    const copyLine = "CREATE EVENT TRIGGER trg_ddl_command_end_events ON x;\n";
    const expected = strip(dump.replace(copyLine, "@@COPY@@")).replace("@@COPY@@", copyLine);
    expect(text).toBe(expected);
  });

  it("un trigger marcado que no existe no se reporta como quitado y no altera el dump", async () => {
    const { text, dropped } = await filter(dump, { excludeEventTriggers: ["no_existe"] });
    expect(dropped).toEqual([]);
    expect(text).toBe(dump);
  });

  it("con saltos CRLF (pg_dump en Windows) filtra igual y respeta el COPY", async () => {
    const crlf = dump.replace(/\n/g, "\r\n");
    const { text, dropped } = await filter(crlf, { excludeEventTriggers: ["trg_ddl_command_end_events"] }, 7);
    expect(dropped).toEqual(["trg_ddl_command_end_events"]);
    expect(text).not.toContain("WHEN TAG IN");
    expect(text).toContain("COPY public.t (a) FROM stdin;\r\nCREATE EVENT TRIGGER trg_ddl_command_end_events ON x;\r\n");
  });

  it("un COPY con `CREATE EVENT TRIGGER` de un trigger excluido no se altera", async () => {
    const input = "COPY public.t (a) FROM stdin;\nCREATE EVENT TRIGGER trg ON ddl_command_end\n\\.\nSELECT 1;\n";
    const { text, dropped } = await filter(input, { excludeEventTriggers: ["trg"] });
    expect(text).toBe(input);
    expect(dropped).toEqual([]);
  });
});

describe("parseIdentifier", () => {
  it.each([
    ["trg_x ON ddl_command_end", "trg_x"],
    ["trg_x;", "trg_x"],
    ['"Mi ""Trigger"";x" ON y', 'Mi "Trigger";x'],
    ['"sin cerrar', null],
    ["", null],
  ])("%j → %j", (input, expected) => {
    expect(parseIdentifier(input)).toBe(expected);
  });
});
