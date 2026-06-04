import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./roles.service.js";

export const rolesRouter: Router = Router();
rolesRouter.use(authenticate);

const createSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/, "Clave inválida: usa minúsculas, números y guion bajo"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullish().transform((v) => v ?? null),
  permissions: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish().transform((v) => v ?? null),
  permissions: z.array(z.string()).optional(),
});

rolesRouter.get("/", authorize("roles:read"), async (_req, res, next) => {
  try {
    ok(res, await service.listRoles());
  } catch (err) {
    next(err);
  }
});

rolesRouter.post("/", authorize("roles:write"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const role = await service.createRole(data);
    await recordAudit(req, { action: "roles.create", entityType: "role", entityId: role.id, detail: { key: role.key } });
    ok(res, role, 201);
  } catch (err) {
    next(err);
  }
});

rolesRouter.patch("/:id", authorize("roles:write"), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const role = await service.updateRole(String(req.params.id), data);
    await recordAudit(req, { action: "roles.update", entityType: "role", entityId: role.id });
    ok(res, role);
  } catch (err) {
    next(err);
  }
});

rolesRouter.delete("/:id", authorize("roles:write"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteRole(id);
    await recordAudit(req, { action: "roles.delete", entityType: "role", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
