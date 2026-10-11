import { describe, expect, it, vi } from "vitest";

// El servicio importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

import { executionCode } from "@dbkeeper/shared";
import { backupSubject, statusLine, type BackupNotification } from "../src/modules/notifications/notifications.service.js";
import { threadHeaders } from "../src/modules/notifications/email.js";
import { renderEmail } from "../src/modules/notifications/email-template.js";

const EXEC = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const base: BackupNotification = {
  event: "start",
  executionId: EXEC,
  runAt: new Date(2026, 9, 11, 23, 30),
  instance: "pg-ventas",
  jobName: "BK - pg-ventas",
  engine: "postgres",
  databases: ["ventas", "clientes"],
};

describe("executionCode", () => {
  it("8 primeros caracteres del id, sin guiones y en mayúsculas", () => {
    expect(executionCode(EXEC)).toBe("3F2504E0");
  });
});

describe("backupSubject", () => {
  it("omite la instancia si el nombre del evento ya la contiene", () => {
    expect(backupSubject(base)).toBe("[DBKeeper] BK - pg-ventas · 11/10/2026 · #3F2504E0");
    expect(backupSubject({ ...base, instance: "PG-VENTAS" })).toBe("[DBKeeper] BK - pg-ventas · 11/10/2026 · #3F2504E0");
  });

  it("antepone la instancia si el evento tiene otro nombre", () => {
    expect(backupSubject({ ...base, jobName: "Diario" })).toBe("[DBKeeper] pg-ventas · Diario · 11/10/2026 · #3F2504E0");
  });

  it("es el mismo para todos los avisos de la ejecución (sin estado)", () => {
    const end = { ...base, event: "failure" as const };
    expect(backupSubject(end)).toBe(backupSubject(base));
  });
});

describe("statusLine", () => {
  it("resume el estado de cada aviso", () => {
    expect(statusLine(base)).toBe("En curso — 2 bases de datos");
    expect(
      statusLine({
        ...base,
        event: "failure",
        items: [
          { dbName: "ventas", status: "success", bytes: 10 },
          { dbName: "clientes", status: "failed", error: "x" },
        ],
      }),
    ).toBe("Con errores — 1 de 2 BD falló (clientes)");
    expect(statusLine({ ...base, event: "integrity", databases: ["ventas"] })).toBe(
      "Integridad — archivo alterado o faltante: ventas",
    );
  });
});

describe("hilo de correo", () => {
  it("SMTP: In-Reply-To/References con el dominio del remitente", () => {
    expect(threadHeaders("dbkeeper-exec-1", "DBKeeper <no-reply@empresa.com>")).toEqual({
      references: "<dbkeeper-exec-1@empresa.com>",
      inReplyTo: "<dbkeeper-exec-1@empresa.com>",
    });
  });

  it("la vista previa va oculta al inicio del cuerpo", () => {
    const html = renderEmail({ tone: "info", status: "En curso", title: "t", preheader: "En curso — 2 <BD>", sentAt: "x" });
    expect(html).toMatch(/<div style="display:none[^"]*">En curso — 2 &lt;BD&gt;/);
  });
});
