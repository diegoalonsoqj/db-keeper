import { Router } from "express";
import { z } from "zod";
import { APP_LOCALES } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import * as service from "./settings.service.js";

export const settingsRouter: Router = Router();
settingsRouter.use(authenticate);

const generalSchema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  defaultLanguage: z.enum(APP_LOCALES).optional(),
});

const ldapSchema = z.object({
  enabled: z.boolean().optional(),
  url: z.string().max(255).optional(),
  bindDn: z.string().max(512).optional(),
  searchBase: z.string().max(512).optional(),
  userFilter: z.string().max(255).optional(),
  tlsRejectUnauthorized: z.boolean().optional(),
  bindPassword: z.string().max(1024).optional(),
});

settingsRouter.get("/", authorize("settings:read"), async (_req, res, next) => {
  try {
    ok(res, await service.getSettings());
  } catch (err) {
    next(err);
  }
});

settingsRouter.patch("/general", authorize("settings:write"), async (req, res, next) => {
  try {
    const data = generalSchema.parse(req.body);
    const general = await service.updateGeneral(data);
    await recordAudit(req, { action: "settings.update", entityType: "settings", entityId: "general" });
    ok(res, general);
  } catch (err) {
    next(err);
  }
});

settingsRouter.patch("/ldap", authorize("settings:write"), async (req, res, next) => {
  try {
    const data = ldapSchema.parse(req.body);
    const ldap = await service.updateLdap(data);
    // No registrar el cuerpo: puede contener la contraseña de bind.
    await recordAudit(req, { action: "settings.update", entityType: "settings", entityId: "ldap" });
    ok(res, ldap);
  } catch (err) {
    next(err);
  }
});
