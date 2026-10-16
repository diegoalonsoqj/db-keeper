import { describe, expect, it } from "vitest";
import {
  collectionRuleError,
  matchCollectionRule,
  parseCollectionRules,
  wildcardMatch,
} from "@dbkeeper/shared";
import { normalizeExclusions } from "../src/modules/backups/exclusions.js";
import { HttpError } from "../src/lib/http-error.js";

describe("wildcardMatch", () => {
  it("sufijos, prefijos y patrones intermedios", () => {
    expect(wildcardMatch("*_old", "users_old")).toBe(true);
    expect(wildcardMatch("*_old", "users_old2")).toBe(false);
    expect(wildcardMatch("tmp_*", "tmp_x")).toBe(true);
    expect(wildcardMatch("tmp_*", "x_tmp_")).toBe(false);
    expect(wildcardMatch("logs_2023*", "logs_2023_01")).toBe(true);
    expect(wildcardMatch("a*b*c", "aXXbYYc")).toBe(true);
    expect(wildcardMatch("a*b*c", "aXXbYY")).toBe(false);
  });

  it("nombre exacto y sin distinguir mayúsculas", () => {
    expect(wildcardMatch("audit_log", "audit_log")).toBe(true);
    expect(wildcardMatch("audit_log", "audit_logs")).toBe(false);
    expect(wildcardMatch("*_BAK", "Orders_bak")).toBe(true);
  });

  it("los demás caracteres son literales (no regex)", () => {
    expect(wildcardMatch("a.b", "aXb")).toBe(false);
    expect(wildcardMatch("fs.*", "fs.chunks")).toBe(true);
    expect(wildcardMatch("(x)+", "(x)+")).toBe(true);
  });

  it("no se degrada con muchos comodines (sin ReDoS)", () => {
    const start = Date.now();
    expect(wildcardMatch("*a*a*a*a*a*a*a*a*b", "a".repeat(5000))).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe("matchCollectionRule", () => {
  const dbs = ["ventas", "notification-db"];

  it("devuelve la primera regla que coincide", () => {
    expect(matchCollectionRule(["*_old", "*_bak"], "ventas", "pedidos_bak", dbs)).toBe("*_bak");
    expect(matchCollectionRule(["*_old"], "ventas", "pedidos", dbs)).toBeNull();
  });

  it("el prefijo <bd>. limita la regla a esa BD", () => {
    expect(matchCollectionRule(["ventas.*_bk"], "ventas", "x_bk", dbs)).toBe("ventas.*_bk");
    expect(matchCollectionRule(["ventas.*_bk"], "notification-db", "x_bk", dbs)).toBeNull();
  });

  it("un prefijo que no es BD del evento es parte del patrón (p. ej. GridFS)", () => {
    expect(matchCollectionRule(["fs.*"], "ventas", "fs.chunks", dbs)).toBe("fs.*");
    expect(matchCollectionRule(["fs.*"], "ventas", "pedidos", dbs)).toBeNull();
  });
});

describe("collectionRuleError", () => {
  it("rechaza reglas que excluyen todo", () => {
    expect(collectionRuleError("*", ["app"])).toMatch(/todas/);
    expect(collectionRuleError("**", [])).toMatch(/todas/);
    expect(collectionRuleError("app.*", ["app"])).toMatch(/todas/);
  });

  it("acepta patrones normales y fs.* si fs no es BD del evento", () => {
    expect(collectionRuleError("*_old", ["app"])).toBeNull();
    expect(collectionRuleError("fs.*", ["app"])).toBeNull();
  });

  it("rechaza vacías, con NUL o demasiado largas", () => {
    expect(collectionRuleError("", ["app"])).not.toBeNull();
    expect(collectionRuleError("a\0b", ["app"])).not.toBeNull();
    expect(collectionRuleError("x".repeat(256), ["app"])).not.toBeNull();
  });
});

describe("parseCollectionRules", () => {
  it("separa por comas y líneas, recorta y quita duplicadas sin distinguir mayúsculas", () => {
    expect(parseCollectionRules(" *_old, *_bak\n*_OLD\n\n tmp_* ")).toEqual(["*_old", "*_bak", "tmp_*"]);
  });
});

describe("distinguiendo mayúsculas", () => {
  const dbs = ["app"];

  it("wildcardMatch y matchCollectionRule respetan el modo", () => {
    expect(wildcardMatch("*_bak", "X_BAK", true)).toBe(false);
    expect(wildcardMatch("*_bak", "x_bak", true)).toBe(true);
    expect(matchCollectionRule(["app.Users"], "app", "users", dbs, true)).toBeNull();
    expect(matchCollectionRule(["app.Users"], "app", "Users", dbs, true)).toBe("app.Users");
    expect(matchCollectionRule(["app.Users"], "app", "users", dbs)).toBe("app.Users");
  });

  it("no trata como duplicadas reglas que solo cambian en mayúsculas", () => {
    expect(parseCollectionRules("app.Users\napp.users", true)).toEqual(["app.Users", "app.users"]);
    expect(parseCollectionRules("app.Users\napp.users")).toEqual(["app.Users"]);
  });

  it("normalizeExclusions guarda la opción solo si es true y hay reglas", () => {
    expect(
      normalizeExclusions({ excludeCollections: ["app.Users", "app.users"], excludeCollectionsCaseSensitive: true }, dbs),
    ).toEqual({ excludeCollections: ["app.Users", "app.users"], excludeCollectionsCaseSensitive: true });
    expect(normalizeExclusions({ excludeCollections: ["*_old"], excludeCollectionsCaseSensitive: false }, dbs)).toEqual({
      excludeCollections: ["*_old"],
    });
    expect(normalizeExclusions({ excludeCollectionsCaseSensitive: true }, dbs)).toEqual({});
  });
});

describe("normalizeExclusions · excludeCollections", () => {
  it("recorta, quita duplicadas y conserva el resto de opciones", () => {
    const out = normalizeExclusions({ compress: true, excludeCollections: [" *_old ", "*_OLD", "*_bak", ""] }, ["app"]);
    expect(out).toEqual({ compress: true, excludeCollections: ["*_old", "*_bak"] });
  });

  it("quita la clave si no hay reglas o la forma es inválida", () => {
    expect(normalizeExclusions({ excludeCollections: [] }, ["app"])).toEqual({});
    expect(normalizeExclusions({ excludeCollections: "*_old" }, ["app"])).toEqual({});
  });

  it("rechaza (400) una regla que excluiría todas las colecciones", () => {
    expect(() => normalizeExclusions({ excludeCollections: ["app.*"] }, ["app"])).toThrow(HttpError);
  });

  it("rechaza más de 200 reglas", () => {
    const many = Array.from({ length: 201 }, (_, i) => `c${i}_*`);
    expect(() => normalizeExclusions({ excludeCollections: many }, ["app"])).toThrow(/200/);
  });
});
