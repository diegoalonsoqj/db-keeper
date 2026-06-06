import { Router } from "express";
import { z } from "zod";
import { APP_LOCALES, EMAIL_PROVIDERS } from "@dbkeeper/shared";
import { ok } from "../../lib/respond.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import { sendTestNotification } from "../notifications/notifications.service.js";
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

const notificationsSchema = z.object({
  notifyOnStart: z.boolean().optional(),
  notifyOnSuccess: z.boolean().optional(),
  notifyOnFailure: z.boolean().optional(),
  email: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.enum(EMAIL_PROVIDERS).optional(),
      from: z.string().max(255).optional(),
      recipients: z.array(z.string().email().max(255)).max(50).optional(),
      smtp: z
        .object({
          host: z.string().max(255).optional(),
          port: z.number().int().min(1).max(65535).optional(),
          secure: z.boolean().optional(),
          user: z.string().max(255).optional(),
          password: z.string().max(1024).optional(),
        })
        .optional(),
      api: z
        .object({
          url: z.string().max(1024).optional(),
          authHeader: z.string().max(255).optional(),
          auth: z.string().max(2048).optional(),
        })
        .optional(),
    })
    .optional(),
  telegram: z
    .object({
      enabled: z.boolean().optional(),
      chatId: z.string().max(255).optional(),
      botToken: z.string().max(1024).optional(),
    })
    .optional(),
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

settingsRouter.patch("/notifications", authorize("settings:write"), async (req, res, next) => {
  try {
    const data = notificationsSchema.parse(req.body);
    const notifications = await service.updateNotifications(data);
    // No registrar el cuerpo: puede contener la contraseña SMTP, la auth de la API o el bot token.
    await recordAudit(req, { action: "settings.update", entityType: "settings", entityId: "notifications" });
    ok(res, notifications);
  } catch (err) {
    next(err);
  }
});

settingsRouter.post("/notifications/test", authorize("settings:write"), async (req, res, next) => {
  try {
    const result = await sendTestNotification();
    await recordAudit(req, { action: "settings.test", entityType: "settings", entityId: "notifications" });
    ok(res, result);
  } catch (err) {
    next(err);
  }
});
