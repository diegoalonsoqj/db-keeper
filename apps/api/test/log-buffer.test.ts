import { describe, expect, it } from "vitest";
import { clock, createLogBuffer, isErrorLine, MAX_LOG_CHARS } from "../src/modules/backups/engine/log-buffer.js";

const at = (h: number, m: number, s: number) => () => new Date(2026, 9, 22, h, m, s);

describe("createLogBuffer", () => {
  it("antepone la hora a cada línea y devuelve la línea formateada", () => {
    const b = createLogBuffer(null, at(9, 5, 7));
    expect(b.push("pg_dump: leyendo esquemas")).toBe("09:05:07 pg_dump: leyendo esquemas");
    expect(b.text()).toBe("09:05:07 pg_dump: leyendo esquemas");
  });

  it("vacío devuelve null", () => {
    expect(createLogBuffer().text()).toBeNull();
  });

  it("al retomar conserva el log previo tal cual", () => {
    const b = createLogBuffer("08:00:00 Método: pg_dump", at(8, 30, 0));
    b.push("reanudado");
    expect(b.text()).toBe("08:00:00 Método: pg_dump\n08:30:00 reanudado");
  });

  it("con muchas líneas conserva principio y final con la marca de omitidas", () => {
    const b = createLogBuffer(null, at(10, 0, 0));
    for (let i = 1; i <= 5000; i++) b.push(`l${i}`);
    b.push("SHA-256: abc");
    const lines = b.text()!.split("\n");
    expect(lines[0]).toBe("10:00:00 l1");
    expect(lines.at(-1)).toBe("10:00:00 SHA-256: abc");
    expect(lines).toContain("… 3001 líneas omitidas …");
    expect(lines).toHaveLength(2001);
  });

  it("respeta el tope de caracteres sin perder el final", () => {
    const b = createLogBuffer(null, at(10, 0, 0));
    const long = "x".repeat(200);
    for (let i = 0; i < 1500; i++) b.push(`${i} ${long}`);
    b.push("Integridad verificada en el bucket");
    const text = b.text()!;
    expect(text.length).toBeLessThanOrEqual(MAX_LOG_CHARS);
    expect(text.startsWith("10:00:00 0 ")).toBe(true);
    expect(text.endsWith("Integridad verificada en el bucket")).toBe(true);
    expect(text).toMatch(/… \d+ líneas omitidas …/);
  });

  it("rescata del medio omitido las líneas con error, en orden y entre marcas", () => {
    const b = createLogBuffer(null, at(10, 0, 0));
    for (let i = 1; i <= 5000; i++) {
      if (i === 1500) b.push('pg_dump: error: query failed: permission denied for table "x"');
      else if (i === 2500) b.push("mongodump: Failed: error reading collection");
      else b.push(`l${i}`);
    }
    b.push("SHA-256: abc");
    const lines = b.text()!.split("\n");
    const mark = lines.indexOf("… 2999 líneas omitidas; se conservan abajo 2 con error o aviso …");
    expect(mark).toBe(1000);
    expect(lines[mark + 1]).toBe('10:00:00 pg_dump: error: query failed: permission denied for table "x"');
    expect(lines[mark + 2]).toBe("10:00:00 mongodump: Failed: error reading collection");
    expect(lines[mark + 3]).toBe("…");
    expect(lines[mark + 4]).toBe("10:00:00 l4002");
    expect(lines.at(-1)).toBe("10:00:00 SHA-256: abc");
  });

  it("rescata también errores que salen del final en el último recorte (sin lote completo)", () => {
    const b = createLogBuffer(null, at(10, 0, 0));
    for (let i = 1; i <= 2500; i++) b.push(i === 1200 ? "WARNING: archivo truncado" : `l${i}`);
    const text = b.text()!;
    expect(text).toContain("se conservan abajo 1 con error o aviso");
    expect(text).toContain("10:00:00 WARNING: archivo truncado");
  });

  it("pone tope a los errores rescatados e informa cuántos hubo", () => {
    const b = createLogBuffer(null, at(10, 0, 0));
    for (let i = 1; i <= 1000; i++) b.push(`l${i}`);
    for (let i = 1; i <= 5000; i++) b.push(`warning: fila ${i}`);
    for (let i = 1; i <= 1000; i++) b.push(`t${i}`);
    const text = b.text()!;
    expect(text.length).toBeLessThanOrEqual(MAX_LOG_CHARS);
    expect(text).toContain("se conservan abajo 200 de 5000 con error o aviso");
    expect(text.endsWith("10:00:00 t1000")).toBe(true);
  });

  it("sin errores en el medio deja la marca de siempre", () => {
    const b = createLogBuffer(null, at(10, 0, 0));
    for (let i = 1; i <= 2001; i++) b.push(`l${i}`);
    expect(b.text()!.split("\n")).toContain("… 1 línea omitida …");
  });
});

describe("isErrorLine", () => {
  it("reconoce errores y avisos de los motores sin falsos positivos obvios", () => {
    for (const l of [
      "pg_dump: error: connection failed",
      "mysqldump: Got error: 1045: Access denied",
      "Failed: cannot dump collection",
      "Msg 3201, Level 16, State 1",
      "FATAL: password authentication failed",
      "La subida falló",
    ])
      expect(isErrorLine(l), l).toBe(true);
    for (const l of ["pg_dump: dumping contents of table public.errores_log", "Msg 3211, Level 0, State 1: 10 percent processed", "writing 1000 documents"])
      expect(isErrorLine(l), l).toBe(false);
  });
});

describe("clock", () => {
  it("formatea HH:MM:SS con ceros", () => {
    expect(clock(new Date(2026, 0, 1, 7, 3, 9))).toBe("07:03:09");
  });
});
