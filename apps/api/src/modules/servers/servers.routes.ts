import { Router } from "express";
import { z } from "zod";
import { DB_ENGINES } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import { databasesRouter } from "../databases/databases.routes.js";
import * as service from "./servers.service.js";

export const serversRouter: Router = Router();
serversRouter.use(authenticate);

const serverFields = {
  name: z.string().min(1).max(120),
  engine: z.enum(DB_ENGINES),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  environment: z.string().max(60).nullish().transform((v) => v ?? null),
  useSsl: z.boolean().default(false),
  isCloudSql: z.boolean().default(false),
  gcpProject: z.string().max(255).nullish().transform((v) => v ?? null),
  gcpInstance: z.string().max(255).nullish().transform((v) => v ?? null),
  notes: z.string().max(1000).nullish().transform((v) => v ?? null),
  // Credencial del catálogo (reutilizable). Puede asignarse luego.
  credentialId: z.string().uuid().nullish().transform((v) => v ?? null),
};

const createSchema = z.object({ ...serverFields });

const updateSchema = z.object({
  name: serverFields.name.optional(),
  engine: serverFields.engine.optional(),
  host: serverFields.host.optional(),
  port: serverFields.port.optional(),
  environment: serverFields.environment,
  useSsl: z.boolean().optional(),
  isCloudSql: z.boolean().optional(),
  gcpProject: serverFields.gcpProject,
  gcpInstance: serverFields.gcpInstance,
  notes: serverFields.notes,
  credentialId: serverFields.credentialId,
});

serversRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.listServers(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

serversRouter.get("/:id", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.getServer(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

serversRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const server = await service.createServer(data);
    await recordAudit(req, { action: "servers.create", entityType: "server", entityId: server.id, detail: { name: server.name, engine: server.engine } });
    ok(res, server, 201);
  } catch (err) {
    next(err);
  }
});

serversRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const server = await service.updateServer(String(req.params.id), data);
    await recordAudit(req, { action: "servers.update", entityType: "server", entityId: server.id });
    ok(res, server);
  } catch (err) {
    next(err);
  }
});

serversRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteServer(id);
    await recordAudit(req, { action: "servers.delete", entityType: "server", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

// Sub-recurso: bases de datos de una instancia (descubrimiento + selección).
serversRouter.use("/:serverId/databases", databasesRouter);
