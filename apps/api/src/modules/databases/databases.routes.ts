import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authorize } from "../../middleware/auth.js";
import * as service from "./databases.service.js";

// Montado bajo /api/servers/:serverId/databases (hereda authenticate de servers).
export const databasesRouter: Router = Router({ mergeParams: true });

const idSchema = z.string().uuid();
// Credencial opcional para descubrir (override del evento); si no viene, se usa la de la instancia.
// `via: "cloudsql"` lista las BDs con la API de Cloud SQL Admin (sin conectarse a la BD).
const discoverBodySchema = z.object({
  credentialId: z.string().uuid().nullish().transform((v) => v ?? null),
  via: z.enum(["direct", "cloudsql"]).default("direct"),
});

// Descubrimiento en vivo: lista las BDs reales de la instancia (reutilizado por el
// asistente de eventos de backup). La selección se persiste en el evento, no aquí.
const schemasBodySchema = z.object({
  dbName: z.string().min(1).max(255),
  credentialId: z.string().uuid().nullish().transform((v) => v ?? null),
});

// Esquemas de una BD de PostgreSQL, para elegir cuáles excluir del dump.
databasesRouter.post("/schemas", authorize("servers:read"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    const { dbName, credentialId } = schemasBodySchema.parse(req.body ?? {});
    ok(res, await service.listSchemas(serverId, dbName, credentialId));
  } catch (err) {
    next(err);
  }
});

// Extensiones de una BD de PostgreSQL, para elegir cuáles excluir del dump.
databasesRouter.post("/extensions", authorize("servers:read"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    const { dbName, credentialId } = schemasBodySchema.parse(req.body ?? {});
    ok(res, await service.listExtensions(serverId, dbName, credentialId));
  } catch (err) {
    next(err);
  }
});

// Event triggers de una BD de PostgreSQL, para elegir cuáles excluir del dump.
databasesRouter.post("/event-triggers", authorize("servers:read"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    const { dbName, credentialId } = schemasBodySchema.parse(req.body ?? {});
    ok(res, await service.listEventTriggers(serverId, dbName, credentialId));
  } catch (err) {
    next(err);
  }
});

databasesRouter.post("/discover", authorize("servers:read"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    const { credentialId, via } = discoverBodySchema.parse(req.body ?? {});
    ok(res, via === "cloudsql" ? await service.discoverCloudSql(serverId) : await service.discover(serverId, credentialId));
  } catch (err) {
    next(err);
  }
});
