import { describe, expect, it } from "vitest";
import { quotedPatternArgs } from "../src/modules/backups/engine/pg-args.js";

describe("quotedPatternArgs", () => {
  it("genera un argumento por extensión, entre comillas dobles", () => {
    expect(quotedPatternArgs("--exclude-extension", ["pgaudit", "pg_stat_statements"])).toEqual([
      '--exclude-extension="pgaudit"',
      '--exclude-extension="pg_stat_statements"',
    ]);
  });

  it("duplica las comillas internas", () => {
    expect(quotedPatternArgs("--exclude-extension", ['ext"rara'])).toEqual(['--exclude-extension="ext""rara"']);
  });

  it("deja comodines y mayúsculas como literales dentro de las comillas", () => {
    expect(quotedPatternArgs("--exclude-schema", ["Ventas*", "a?b"])).toEqual([
      '--exclude-schema="Ventas*"',
      '--exclude-schema="a?b"',
    ]);
  });

  it("sin nombres no genera argumentos", () => {
    expect(quotedPatternArgs("--exclude-extension", [])).toEqual([]);
  });
});
