import { Router } from "express";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import * as repo from "./dashboard.repository.js";

export const dashboardRouter: Router = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get("/", authorize("backups:read"), async (_req, res, next) => {
  try {
    ok(res, await repo.getDashboard());
  } catch (err) {
    next(err);
  }
});
