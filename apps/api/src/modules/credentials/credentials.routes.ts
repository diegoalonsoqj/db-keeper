import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./credentials.service.js";

export const credentialsRouter: Router = Router();
credentialsRouter.use(authenticate);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
  extra: z.record(z.unknown()).nullish().transform((v) => v ?? null),
  environment: z.string().max(12).nullish().transform((v) => v ?? null),
  description: z.string().max(500).nullish().transform((v) => v ?? null),
});

// En update, omitir un campo = no tocarlo; enviar null explícito = limpiarlo.
// (No usar `.transform(undefined → null)`: borraría `extra`/`description` en PATCH
// parciales, p. ej. al editar sin reescribir el `extra` guardado.)
const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  username: z.string().min(1).max(255).optional(),
  password: z.string().min(1).max(1024).optional(),
  extra: z.record(z.unknown()).nullable().optional(),
  environment: z.string().max(12).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

credentialsRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.listCredentials(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

credentialsRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const cred = await service.createCredential(data);
    await recordAudit(req, { action: "credentials.create", entityType: "credential", entityId: cred.id, detail: { name: cred.name } });
    ok(res, cred, 201);
  } catch (err) {
    next(err);
  }
});

credentialsRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const cred = await service.updateCredential(String(req.params.id), data);
    await recordAudit(req, { action: "credentials.update", entityType: "credential", entityId: cred.id });
    ok(res, cred);
  } catch (err) {
    next(err);
  }
});

credentialsRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteCredential(id);
    await recordAudit(req, { action: "credentials.delete", entityType: "credential", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
