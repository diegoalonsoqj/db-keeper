import { Router } from "express";
import { z } from "zod";
import { STORAGE_TYPES } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./storage.service.js";

export const storageRouter: Router = Router();
storageRouter.use(authenticate);

const fields = {
  type: z.enum(STORAGE_TYPES),
  name: z.string().min(1).max(120),
  path: z.string().max(500).nullish().transform((v) => v ?? null),
  bucket: z.string().max(255).nullish().transform((v) => v ?? null),
  prefix: z.string().max(255).nullish().transform((v) => v ?? null),
  gcpServiceAccountId: z.string().uuid().nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
};

const createSchema = z.object({ ...fields });
const updateSchema = z.object({
  type: fields.type,
  name: fields.name,
  path: fields.path,
  bucket: fields.bucket,
  prefix: fields.prefix,
  gcpServiceAccountId: fields.gcpServiceAccountId,
  isActive: z.boolean().default(true),
});

storageRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.listTargets(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

storageRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const tgt = await service.createTarget(createSchema.parse(req.body));
    await recordAudit(req, { action: "storage.create", entityType: "storage_target", entityId: tgt.id, detail: { name: tgt.name, type: tgt.type } });
    ok(res, tgt, 201);
  } catch (err) {
    next(err);
  }
});

storageRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const tgt = await service.updateTarget(String(req.params.id), updateSchema.parse(req.body));
    await recordAudit(req, { action: "storage.update", entityType: "storage_target", entityId: tgt.id });
    ok(res, tgt);
  } catch (err) {
    next(err);
  }
});

// Marca el destino como por defecto de su tipo.
storageRouter.post("/:id/default", authorize("servers:write"), async (req, res, next) => {
  try {
    const tgt = await service.setDefault(String(req.params.id));
    await recordAudit(req, { action: "storage.set_default", entityType: "storage_target", entityId: tgt.id });
    ok(res, tgt);
  } catch (err) {
    next(err);
  }
});

storageRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteTarget(id);
    await recordAudit(req, { action: "storage.delete", entityType: "storage_target", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
