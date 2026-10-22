import { Router } from "express";
import { z } from "zod";
import { ARTIFACT_KINDS, ARTIFACT_SORTS, ARTIFACT_STATES, DB_ENGINES } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { listQuerySchema, textParam } from "../../lib/list-query.js";
import * as service from "./artifacts.service.js";

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
