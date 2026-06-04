import { Router } from "express";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { listPermissions } from "./permissions.repository.js";

export const permissionsRouter: Router = Router();
permissionsRouter.use(authenticate);

/** Catálogo de permisos disponibles (para la matriz del módulo Roles). */
permissionsRouter.get("/", authorize("roles:read"), async (_req, res, next) => {
  try {
    ok(res, await listPermissions());
  } catch (err) {
    next(err);
  }
});
