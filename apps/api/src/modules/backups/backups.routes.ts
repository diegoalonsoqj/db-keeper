import { Router } from "express";
import { z } from "zod";
import { BACKUP_METHODS } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./backups.service.js";

export const backupsRouter: Router = Router();
backupsRouter.use(authenticate);

const jobFields = {
  name: z.string().min(1).max(120),
  serverId: z.string().uuid(),
  credentialId: z.string().uuid().nullish().transform((v) => v ?? null),
  method: z.enum(BACKUP_METHODS),
  bucketId: z.string().uuid().nullish().transform((v) => v ?? null),
  options: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  databases: z.array(z.string().min(1).max(255)).min(1).max(2000),
};

const createSchema = z.object({ ...jobFields });

const updateSchema = z.object({
  name: jobFields.name.optional(),
  serverId: jobFields.serverId.optional(),
  credentialId: jobFields.credentialId,
  method: jobFields.method.optional(),
  bucketId: jobFields.bucketId,
  options: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
  databases: z.array(z.string().min(1).max(255)).min(1).max(2000).optional(),
});

// Las ejecuciones se listan antes de "/:id" para que no las capture el parámetro.
backupsRouter.get("/executions", authorize("backups:read"), async (req, res, next) => {
  try {
    const p = paginationSchema.parse(req.query);
    const jobId = z.string().uuid().optional().parse(req.query.jobId);
    ok(res, await service.listExecutions({ ...p, jobId }));
  } catch (err) {
    next(err);
  }
});

backupsRouter.get("/", authorize("backups:read"), async (req, res, next) => {
  try {
    ok(res, await service.listJobs(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

backupsRouter.get("/:id", authorize("backups:read"), async (req, res, next) => {
  try {
    ok(res, await service.getJob(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

backupsRouter.post("/", authorize("backups:schedule"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const job = await service.createJob(data);
    await recordAudit(req, {
      action: "backups.create",
      entityType: "backup_job",
      entityId: job.id,
      detail: { name: job.name, databases: job.databases.length },
    });
    ok(res, job, 201);
  } catch (err) {
    next(err);
  }
});

backupsRouter.patch("/:id", authorize("backups:schedule"), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const job = await service.updateJob(String(req.params.id), data);
    await recordAudit(req, { action: "backups.update", entityType: "backup_job", entityId: job.id });
    ok(res, job);
  } catch (err) {
    next(err);
  }
});

backupsRouter.delete("/:id", authorize("backups:schedule"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteJob(id);
    await recordAudit(req, { action: "backups.delete", entityType: "backup_job", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

backupsRouter.post("/:id/run", authorize("backups:run"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const exec = await service.runNow(id);
    await recordAudit(req, {
      action: "backups.run",
      entityType: "backup_job",
      entityId: id,
      detail: { executionId: exec.id },
    });
    ok(res, exec, 201);
  } catch (err) {
    next(err);
  }
});
