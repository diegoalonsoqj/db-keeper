import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./environments.service.js";

export const environmentsRouter: Router = Router();
environmentsRouter.use(authenticate);

const fields = {
  name: z.string().min(1).max(60),
  description: z.string().max(255).nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
};

const createSchema = z.object({ ...fields });
const updateSchema = z.object({
  name: fields.name.optional(),
  description: fields.description,
  isActive: z.boolean().optional(),
});

// Reutiliza los permisos de instancias (mismo patrón que buckets).
environmentsRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.listEnvironments(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

environmentsRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const env = await service.createEnvironment(createSchema.parse(req.body));
    await recordAudit(req, {
      action: "environments.create",
      entityType: "environment",
      entityId: env.id,
      detail: { name: env.name },
    });
    ok(res, env, 201);
  } catch (err) {
    next(err);
  }
});

environmentsRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const env = await service.updateEnvironment(String(req.params.id), updateSchema.parse(req.body));
    await recordAudit(req, { action: "environments.update", entityType: "environment", entityId: env.id });
    ok(res, env);
  } catch (err) {
    next(err);
  }
});

environmentsRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteEnvironment(id);
    await recordAudit(req, { action: "environments.delete", entityType: "environment", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
