import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { listAudit } from "./audit.service.js";

export const auditRouter: Router = Router();
auditRouter.use(authenticate);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().max(100).optional(),
  entityType: z.string().max(60).optional(),
  username: z.string().max(255).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

auditRouter.get("/", authorize("audit:read"), async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    ok(res, await listAudit(q));
  } catch (err) {
    next(err);
  }
});
