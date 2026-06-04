import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../../lib/http-error.js";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./users.service.js";

export const usersRouter: Router = Router();
usersRouter.use(authenticate);

const createSchema = z.object({
  username: z.string().min(1).max(255),
  email: z.string().email().nullish().transform((v) => v ?? null),
  fullName: z.string().max(255).nullish().transform((v) => v ?? null),
  authType: z.enum(["local", "ad"]).default("local"),
  password: z.string().min(8).max(1024).optional(),
  isActive: z.boolean().default(true),
  roleKeys: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  email: z.string().email().nullish().transform((v) => v ?? null),
  fullName: z.string().max(255).nullish().transform((v) => v ?? null),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(1024).optional(),
  roleKeys: z.array(z.string()).optional(),
});

usersRouter.get("/", authorize("users:read"), async (_req, res, next) => {
  try {
    ok(res, await service.listUsers());
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:id", authorize("users:read"), async (req, res, next) => {
  try {
    ok(res, await service.getUser(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

usersRouter.post("/", authorize("users:write"), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const user = await service.createUser(data);
    await recordAudit(req, { action: "users.create", entityType: "user", entityId: user.id, detail: { username: user.username } });
    ok(res, user, 201);
  } catch (err) {
    next(err);
  }
});

usersRouter.patch("/:id", authorize("users:write"), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const user = await service.updateUser(String(req.params.id), data);
    await recordAudit(req, { action: "users.update", entityType: "user", entityId: user.id });
    ok(res, user);
  } catch (err) {
    next(err);
  }
});

usersRouter.delete("/:id", authorize("users:delete"), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (req.auth!.user.id === id) throw HttpError.badRequest("No puedes eliminar tu propio usuario");
    await service.deleteUser(id);
    await recordAudit(req, { action: "users.delete", entityType: "user", entityId: id });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});
