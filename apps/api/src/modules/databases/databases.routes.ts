import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authorize } from "../../middleware/auth.js";
import * as service from "./databases.service.js";

// Montado bajo /api/servers/:serverId/databases (hereda authenticate de servers).
export const databasesRouter: Router = Router({ mergeParams: true });

const idSchema = z.string().uuid();
// Credencial opcional para descubrir (override del evento); si no viene, se usa la de la instancia.
const discoverBodySchema = z.object({
  credentialId: z.string().uuid().nullish().transform((v) => v ?? null),
});

// Descubrimiento en vivo: lista las BDs reales de la instancia (reutilizado por el
// asistente de eventos de backup). La selección se persiste en el evento, no aquí.
databasesRouter.post("/discover", authorize("servers:read"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    const { credentialId } = discoverBodySchema.parse(req.body ?? {});
    ok(res, await service.discover(serverId, credentialId));
  } catch (err) {
    next(err);
  }
});
