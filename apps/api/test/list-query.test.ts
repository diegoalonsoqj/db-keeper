import { describe, expect, it } from "vitest";
import { EXECUTION_SORTS, parseExecutionCode } from "@dbkeeper/shared";
import { escapeLike, listQuerySchema, orderBy, SqlWhere } from "../src/lib/list-query.js";

describe("SqlWhere", () => {
  it("parametriza cada valor y omite los vacíos", () => {
    const w = new SqlWhere().eq("e.status", "failed").eq("e.origin", undefined).eq("e.environment", "").eq("j.is_active", false);
    expect(w.sql).toBe("WHERE e.status = $1 AND j.is_active = $2");
    expect(w.params).toEqual(["failed", false]);
  });

  it("búsqueda: ILIKE en varias columnas con un solo parámetro y comodines escapados", () => {
    const w = new SqlWhere().eq("s.engine", "postgres").search(["s.name", "s.host"], "50%_off");
    expect(w.sql).toBe("WHERE s.engine = $1 AND (s.name ILIKE $2 OR s.host ILIKE $2)");
    expect(w.params).toEqual(["postgres", "%50\\%\\_off%"]);
  });

  it("sin filtros no genera WHERE", () => {
    expect(new SqlWhere().search(["x"], undefined).sql).toBe("");
  });
});

describe("escapeLike", () => {
  it("escapa %, _ y la barra invertida", () => {
    expect(escapeLike("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });
});

describe("orderBy", () => {
  const cols = { name: "lower(s.name)", created: "s.created_at" };
  const fallback = { sort: "created" as const, dir: "desc" as const };

  it("sin sort usa el orden por defecto", () => {
    expect(orderBy(cols, undefined, undefined, fallback, "s.id")).toBe("ORDER BY s.created_at DESC NULLS LAST, s.id");
  });

  it("con sort y sin dir ordena ascendente", () => {
    expect(orderBy(cols, "name", undefined, fallback, "s.id")).toBe("ORDER BY lower(s.name) ASC NULLS LAST, s.id");
  });

  it("dir sin sort invierte el orden por defecto", () => {
    expect(orderBy(cols, undefined, "asc", fallback, "s.id")).toBe("ORDER BY s.created_at ASC NULLS LAST, s.id");
  });
});

describe("listQuerySchema", () => {
  const schema = listQuerySchema(EXECUTION_SORTS);

  it("rechaza claves de orden no permitidas (nunca llegan al SQL)", () => {
    expect(() => schema.parse({ sort: "created_at; DROP TABLE x" })).toThrow();
    expect(schema.parse({ sort: "size", dir: "desc" })).toMatchObject({ sort: "size", dir: "desc" });
  });

  it("q vacío o con espacios = sin búsqueda", () => {
    expect(schema.parse({ q: "   " }).q).toBeUndefined();
    expect(schema.parse({ q: " ventas " }).q).toBe("ventas");
  });
});

describe("parseExecutionCode", () => {
  it("reconoce el código con o sin #", () => {
    expect(parseExecutionCode("#3F2504E0")).toBe("3f2504e0");
    expect(parseExecutionCode("3f25")).toBe("3f25");
  });

  it("ignora texto que no es un código", () => {
    expect(parseExecutionCode("BK - ventas")).toBeNull();
    expect(parseExecutionCode("3f2")).toBeNull();
    expect(parseExecutionCode("3f2504e0aa")).toBeNull();
  });
});
