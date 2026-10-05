import { describe, expect, it } from "vitest";
import { normalizeExclusions } from "../src/modules/backups/exclusions.js";

describe("normalizeExclusions · excludeExtensions", () => {
  it("conserva solo BDs del evento, nombres recortados y sin duplicados", () => {
    const out = normalizeExclusions(
      { compress: true, excludeExtensions: { app: [" pgaudit ", "pgaudit", "hstore"], otra: ["pgaudit"] } },
      ["app"],
    );
    expect(out).toEqual({ compress: true, excludeExtensions: { app: ["pgaudit", "hstore"] } });
  });

  it("descarta nombres vacíos, con NUL o de más de 63 caracteres", () => {
    const out = normalizeExclusions({ excludeExtensions: { app: ["", "  ", "a\0b", "x".repeat(64), "ok"] } }, ["app"]);
    expect(out.excludeExtensions).toEqual({ app: ["ok"] });
  });

  it("limita a 200 nombres por BD", () => {
    const many = Array.from({ length: 250 }, (_, i) => `ext${i}`);
    const out = normalizeExclusions({ excludeExtensions: { app: many } }, ["app"]);
    expect((out.excludeExtensions as Record<string, string[]>).app).toHaveLength(200);
  });

  it("quita la clave si no queda nada o la forma es inválida", () => {
    expect(normalizeExclusions({ excludeExtensions: { app: [] } }, ["app"])).toEqual({});
    expect(normalizeExclusions({ excludeExtensions: ["pgaudit"] }, ["app"])).toEqual({});
    expect(normalizeExclusions({ excludeExtensions: { app: "pgaudit" } }, ["app"])).toEqual({});
  });

  it("normaliza esquemas y extensiones a la vez, sin mezclarlos", () => {
    const out = normalizeExclusions(
      { excludeSchemas: { app: ["audit"] }, excludeExtensions: { app: ["pgaudit"] } },
      ["app"],
    );
    expect(out).toEqual({ excludeSchemas: { app: ["audit"] }, excludeExtensions: { app: ["pgaudit"] } });
  });

  it("no modifica el objeto de entrada", () => {
    const input = { excludeExtensions: { app: [" pgaudit "] } };
    normalizeExclusions(input, ["app"]);
    expect(input).toEqual({ excludeExtensions: { app: [" pgaudit "] } });
  });
});
