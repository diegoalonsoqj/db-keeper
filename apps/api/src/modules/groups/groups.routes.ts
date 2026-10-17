import { Router } from "express";
import { GROUP_NOTIFY_MODES } from "@dbkeeper/shared";
import { z } from "zod";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { paginationSchema } from "../../lib/pagination.js";
import { recordAudit } from "../audit/audit.service.js";
import { scheduleSchema } from "../backups/backups.routes.js";
import * as service from "./groups.service.js";

export const groupsRouter: Router = Router();
groupsRouter.use(authenticate);

const jobIds = z.array(z.string().uuid()).min(1).max(200);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(255).nullish().transform((v) => v || null),
  isActive: z.boolean().default(true),
  notifyStart: z.boolean().default(false),
  notifyMode: z.enum(GROUP_NOTIFY_MODES).default("summary"),
  jobIds,
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  // undefined = no cambia; null o "" = la quita.
  description: z.string().trim().max(255).nullable().optional().transform((v) => (v === undefined ? undefined : v || null)),
  isActive: z.boolean().optional(),
  notifyStart: z.boolean().optional(),
  notifyMode: z.enum(GROUP_NOTIFY_MODES).optional(),
  jobIds: jobIds.optional(),
});

groupsRouter.get("/", authorize("groups:read"), async (req, res, next) => {
  try {
    ok(res, await service.listGroups(paginationSchema.parse(req.query)));
  } catch (err) {
    next(err);
  }
});

groupsRouter.get("/:id", authorize("groups:read"), async (req, res, next) => {
  try {
    ok(res, await service.getGroup(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

groupsRouter.post("/", authorize("groups:write"), async (req, res, next) => {
  try {
    const group = await service.createGroup(createSchema.parse(req.body));
    await recordAudit(req, {
      action: "groups.create",
      entityType: "job_group",
      entityId: group.id,
      detail: { name: group.name, jobs: group.members.length },
    });
    ok(res, group, 201);
  } catch (err) {
    next(err);
  }
});

groupsRouter.patch("/:id", authorize("groups:write"), async (req, res, next) => {
  try {
    const group = await service.updateGroup(String(req.params.id), updateSchema.parse(req.body));
    await recordAudit(req, {
      action: "groups.update",
      entityType: "job_group",
      entityId: group.id,
      detail: { name: group.name, jobs: group.members.length },
    });
    ok(res, group);
  } catch (err) {
    next(err);
  }
});

groupsRouter.delete("/:id", authorize("groups:write"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteGroup(id);
    await recordAudit(req, { action: "groups.delete", entityType: "job_group", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

groupsRouter.post("/:id/run", authorize("groups:run"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await service.runGroup(id, "manual");
    await recordAudit(req, {
      action: "groups.run",
      entityType: "job_group",
      entityId: id,
      detail: { executions: result.executionIds.length, skipped: result.skipped },
    });
    ok(res, result, 202);
  } catch (err) {
    next(err);
  }
});

groupsRouter.get("/:id/schedule", authorize("groups:read"), async (req, res, next) => {
  try {
    ok(res, await service.getSchedule(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

groupsRouter.put("/:id/schedule", authorize("groups:write"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const sched = await service.upsertSchedule(id, scheduleSchema.parse(req.body));
    await recordAudit(req, { action: "groups.schedule", entityType: "job_group", entityId: id, detail: { mode: sched.mode } });
    ok(res, sched);
  } catch (err) {
    next(err);
  }
});

groupsRouter.delete("/:id/schedule", authorize("groups:write"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await service.deleteSchedule(id);
    await recordAudit(req, { action: "groups.unschedule", entityType: "job_group", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
