import { Router } from "express";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./gcp-projects.service.js";

export const gcpProjectsRouter: Router = Router();
gcpProjectsRouter.use(authenticate);

// Formato de ID de proyecto de GCP: 6–30 caracteres, minúsculas, dígitos y guiones
// (los antiguos de dominio llevan prefijo, p. ej. "dominio.com:proyecto").
const projectId = z
  .string()
  .trim()
  .regex(/^([a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "ID de proyecto inválido (minúsculas, dígitos y guiones; 6 a 30 caracteres)");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const createSchema = z.object({
  projectId,
  name: optText(120),
  description: optText(255),
  isActive: z.boolean().default(true),
});
const updateSchema = z.object({
  projectId: projectId.optional(),
  name: optText(120),
  description: optText(255),
  isActive: z.boolean().optional(),
});

// Reutiliza los permisos de instancias (como el catálogo de ambientes).
gcpProjectsRouter.get("/", authorize("servers:read"), async (req, res, next) => {
  try {
    ok(res, await service.listGcpProjects(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

gcpProjectsRouter.post("/", authorize("servers:write"), async (req, res, next) => {
  try {
    const p = await service.createGcpProject(createSchema.parse(req.body));
    await recordAudit(req, { action: "gcp_projects.create", entityType: "gcp_project", entityId: p.id, detail: { projectId: p.projectId } });
    ok(res, p, 201);
  } catch (err) {
    next(err);
  }
});

gcpProjectsRouter.patch("/:id", authorize("servers:write"), async (req, res, next) => {
  try {
    const p = await service.updateGcpProject(String(req.params.id), updateSchema.parse(req.body));
    await recordAudit(req, { action: "gcp_projects.update", entityType: "gcp_project", entityId: p.id });
    ok(res, p);
  } catch (err) {
    next(err);
  }
});

gcpProjectsRouter.delete("/:id", authorize("servers:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteGcpProject(id);
    await recordAudit(req, { action: "gcp_projects.delete", entityType: "gcp_project", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
