import { Router } from "express";
import { z } from "zod";
import { STORAGE_PROVIDERS } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./buckets.service.js";

export const bucketsRouter: Router = Router();
bucketsRouter.use(authenticate);

const fields = {
  name: z.string().min(1).max(120),
  provider: z.enum(STORAGE_PROVIDERS).default("gcs"),
  bucket: z.string().min(1).max(255),
  prefix: z.string().max(255).nullish().transform((v) => v ?? null),
  isActive: z.boolean().default(true),
};

const createSchema = z.object({ ...fields, serviceAccount: z.string().max(20000).optional() });

const updateSchema = z.object({
  name: fields.name.optional(),
  provider: z.enum(STORAGE_PROVIDERS).optional(),
  bucket: fields.bucket.optional(),
  prefix: fields.prefix,
  isActive: z.boolean().optional(),
  serviceAccount: z.string().max(20000).optional(),
});

bucketsRouter.get("/", authorize("servers:read"), async (_req, res, next) => {
  try {
    ok(res, await service.listBuckets());
  } catch (err) {
    next(err);
  }
});

bucketsRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const { serviceAccount, ...data } = createSchema.parse(req.body);
    const bucket = await service.createBucket(data, serviceAccount);
    await recordAudit(req, { action: "buckets.create", entityType: "bucket", entityId: bucket.id, detail: { name: bucket.name } });
    ok(res, bucket, 201);
  } catch (err) {
    next(err);
  }
});

bucketsRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const { serviceAccount, ...data } = updateSchema.parse(req.body);
    const bucket = await service.updateBucket(String(req.params.id), data, serviceAccount);
    await recordAudit(req, { action: "buckets.update", entityType: "bucket", entityId: bucket.id });
    ok(res, bucket);
  } catch (err) {
    next(err);
  }
});

bucketsRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteBucket(id);
    await recordAudit(req, { action: "buckets.delete", entityType: "bucket", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
