import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authorize } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./databases.service.js";

// Montado bajo /api/servers/:serverId/databases (hereda authenticate de servers).
export const databasesRouter: Router = Router({ mergeParams: true });

const idSchema = z.string().uuid();
const saveSchema = z.object({
  names: z.array(z.string().min(1).max(255)).max(2000),
});

databasesRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    ok(res, await service.listDatabases(serverId));
  } catch (err) {
    next(err);
  }
});

databasesRouter.post("/discover", authorize("servers:read"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    ok(res, await service.discover(serverId));
  } catch (err) {
    next(err);
  }
});

databasesRouter.put("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const serverId = idSchema.parse(req.params.serverId);
    const { names } = saveSchema.parse(req.body);
    const saved = await service.saveSelection(serverId, names);
    await recordAudit(req, {
      action: "databases.select",
      entityType: "server",
      entityId: serverId,
      detail: { count: saved.length },
    });
    ok(res, saved);
  } catch (err) {
    next(err);
  }
});
