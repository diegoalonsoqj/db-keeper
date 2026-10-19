import { describe, expect, it, vi } from "vitest";

// mongo.ts importa la config al cargarse: valores mínimos de prueba.
vi.hoisted(() => {
  process.env.APP_SECRET_KEY ??= "test-secret-key-0123456789";
  process.env.DBKEEPER_MASTER_KEY ??= Buffer.alloc(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
});

import { maskSecret } from "../src/lib/mask-secret.js";
import { buildMongoUri } from "../src/lib/mongo-uri.js";
import { isUnknownConfigOption, mongodumpConfig } from "../src/modules/backups/engine/mongo.js";

const PWD = "p@ss:w/rd%1 x";

describe("maskSecret", () => {
  it("oculta la contraseña cruda", () => {
    expect(maskSecret(`falló con ${PWD} al conectar`, PWD)).toBe("falló con *** al conectar");
  });

  it("oculta la contraseña codificada dentro de una URI de Mongo", () => {
    const uri = buildMongoUri({ host: "db.local", port: 27017, user: "app", password: PWD, ssl: false, dbName: "ventas", srv: false });
    expect(uri).toContain(encodeURIComponent(PWD));
    const masked = maskSecret(`error conectando a ${uri}`, PWD);
    expect(masked).not.toContain(encodeURIComponent(PWD));
    expect(masked).toContain("app:***@db.local");
  });

  it("sin secreto devuelve el texto igual", () => {
    expect(maskSecret("nada que ocultar", "")).toBe("nada que ocultar");
  });
});

describe("mongodump --config", () => {
  it("genera un YAML con la URI escapada", () => {
    const uri = 'mongodb://app:a%22b@db:27017/x?authSource=admin';
    expect(mongodumpConfig(uri)).toBe(`uri: ${JSON.stringify(uri)}\n`);
  });

  it("detecta binarios que no conocen --config", () => {
    expect(isUnknownConfigOption(new Error('error parsing command line options: unknown option "config"'))).toBe(true);
    expect(isUnknownConfigOption(new Error("unknown option: --config"))).toBe(true);
    expect(isUnknownConfigOption(new Error("server selection error: connection refused"))).toBe(false);
    expect(isUnknownConfigOption(new Error('unknown option "configsvr"'))).toBe(false);
  });
});
