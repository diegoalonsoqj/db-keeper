import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./gcp-accounts.service.js";

export const gcpAccountsRouter: Router = Router();
gcpAccountsRouter.use(authenticate);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  key: z.string().min(1).max(20000),
  isActive: z.boolean().default(true),
});
const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  key: z.string().max(20000).optional(),
  isActive: z.boolean().optional(),
});

gcpAccountsRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.listAccounts(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

gcpAccountsRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const acc = await service.createAccount(createSchema.parse(req.body));
    await recordAudit(req, { action: "gcp_accounts.create", entityType: "gcp_service_account", entityId: acc.id, detail: { name: acc.name } });
    ok(res, acc, 201);
  } catch (err) {
    next(err);
  }
});

gcpAccountsRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const acc = await service.updateAccount(String(req.params.id), updateSchema.parse(req.body));
    await recordAudit(req, { action: "gcp_accounts.update", entityType: "gcp_service_account", entityId: acc.id });
    ok(res, acc);
  } catch (err) {
    next(err);
  }
});

gcpAccountsRouter.post("/:id/default", authorize("servers:write"), async (req, res, next) => {
  try {
    const acc = await service.setDefault(String(req.params.id));
    await recordAudit(req, { action: "gcp_accounts.set_default", entityType: "gcp_service_account", entityId: acc.id });
    ok(res, acc);
  } catch (err) {
    next(err);
  }
});

gcpAccountsRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteAccount(id);
    await recordAudit(req, { action: "gcp_accounts.delete", entityType: "gcp_service_account", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
