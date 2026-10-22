import { Router } from "express";
import { z } from "zod";
import { ARTIFACT_KINDS, ARTIFACT_SORTS, ARTIFACT_STATES, DB_ENGINES, SCAN_FINDING_KINDS } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { listQuerySchema, textParam } from "../../lib/list-query.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./artifacts.service.js";
import * as scans from "./scans.service.js";

/**
 * Catálogo de archivos de backup (solo lectura). La descarga y la verificación siguen
 * en /api/backups/executions/:execId/items/:itemId/…, con sus propios permisos.
 */
export const artifactsRouter: Router = Router();
artifactsRouter.use(authenticate);

const listSchema = listQuerySchema(ARTIFACT_SORTS).extend({
  kind: z.enum(ARTIFACT_KINDS).optional(),
  state: z.enum(ARTIFACT_STATES).optional(),
  environment: textParam,
  engine: z.enum(DB_ENGINES).optional(),
  runnerHost: textParam,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

artifactsRouter.get("/", authorize("backups:read"), async (req, res, next) => {
  try {
    ok(res, await service.listArtifacts(listSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

artifactsRouter.get("/hosts", authorize("backups:read"), async (_req, res, next) => {
  try {
    ok(res, await service.listRunnerHosts());
  } catch (err) {
    next(err);
  }
});

// ---- Conciliación con el disco local (solo lectura: nunca borra) ----

const findingListSchema = paginationSchema.extend({
  q: textParam,
  kind: z.enum(SCAN_FINDING_KINDS).optional(),
  runnerHost: textParam,
});

artifactsRouter.get("/scans", authorize("backups:read"), async (_req, res, next) => {
  try {
    ok(res, await scans.listLatestScans());
  } catch (err) {
    next(err);
  }
});

// Recorre el disco del host que atiende la petición: mismo permiso que gestionar destinos.
artifactsRouter.post("/scans", authorize("storage:manage"), async (req, res, next) => {
  try {
    const result = await scans.startScan(req.auth?.user.id ?? null);
    await recordAudit(req, { action: "artifacts.scan", entityType: "storage" });
    ok(res, result, 202);
  } catch (err) {
    next(err);
  }
});

artifactsRouter.get("/findings", authorize("backups:read"), async (req, res, next) => {
  try {
    ok(res, await scans.listFindings(findingListSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});
