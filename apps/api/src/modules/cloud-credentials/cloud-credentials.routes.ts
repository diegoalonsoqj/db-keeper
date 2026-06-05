import { Router } from "express";
import { z } from "zod";
import { CLOUD_PROVIDERS } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./cloud-credentials.service.js";

export const cloudCredentialsRouter: Router = Router();
cloudCredentialsRouter.use(authenticate);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  provider: z.enum(CLOUD_PROVIDERS).default("gcp"),
  secret: z.string().min(1).max(20000),
  isActive: z.boolean().default(true),
});
const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  secret: z.string().max(20000).optional(),
  isActive: z.boolean().optional(),
});

cloudCredentialsRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.listCredentials(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

cloudCredentialsRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const acc = await service.createCredential(createSchema.parse(req.body));
    await recordAudit(req, { action: "cloud_credentials.create", entityType: "cloud_credential", entityId: acc.id, detail: { name: acc.name, provider: acc.provider } });
    ok(res, acc, 201);
  } catch (err) {
    next(err);
  }
});

cloudCredentialsRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const acc = await service.updateCredential(String(req.params.id), updateSchema.parse(req.body));
    await recordAudit(req, { action: "cloud_credentials.update", entityType: "cloud_credential", entityId: acc.id });
    ok(res, acc);
  } catch (err) {
    next(err);
  }
});

cloudCredentialsRouter.post("/:id/default", authorize("servers:write"), async (req, res, next) => {
  try {
    const acc = await service.setDefault(String(req.params.id));
    await recordAudit(req, { action: "cloud_credentials.set_default", entityType: "cloud_credential", entityId: acc.id });
    ok(res, acc);
  } catch (err) {
    next(err);
  }
});

cloudCredentialsRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteCredential(id);
    await recordAudit(req, { action: "cloud_credentials.delete", entityType: "cloud_credential", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
