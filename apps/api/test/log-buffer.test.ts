import { describe, expect, it } from "vitest";
import { clock, createLogBuffer, MAX_LOG_CHARS } from "../src/modules/backups/engine/log-buffer.js";

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
});

describe("clock", () => {
  it("formatea HH:MM:SS con ceros", () => {
    expect(clock(new Date(2026, 0, 1, 7, 3, 9))).toBe("07:03:09");
  });
});
