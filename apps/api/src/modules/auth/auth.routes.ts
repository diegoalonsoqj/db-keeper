import { Router } from "express";
import { z } from "zod";
import { cookieSecure } from "../../config/env.js";
import { ok } from "../../lib/respond.js";
import { SESSION_COOKIE, signSession } from "../../lib/jwt.js";
import { APP_LOCALES } from "@dbkeeper/shared";
import { authenticate } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import { HttpError } from "../../lib/http-error.js";
import { lockRemainingMs, registerFailure, resetKey } from "../../lib/login-limiter.js";
import { getSecurity } from "../settings/settings.service.js";
import { changeOwnPassword, getIdentity, login, updateOwnProfile } from "./auth.service.js";

export const authRouter: Router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});

const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8h, igual que el TTL del JWT

/** Claves del limitador: por usuario (sin distinguir mayúsculas) y por IP. */
const userKey = (u: string) => `user:${u.trim().toLowerCase()}`;
const ipKey = (ip: string | undefined) => `ip:${ip ?? "?"}`;

authRouter.post("/login", async (req, res, next) => {
  const security = await getSecurity().catch(() => null);
  const limitOn = security?.loginLimitEnabled === true;
  let attemptedUser: string | null = null;
  try {
    const { username, password } = loginSchema.parse(req.body);
    attemptedUser = username;
    if (limitOn) {
      const wait = Math.max(lockRemainingMs(userKey(username)), lockRemainingMs(ipKey(req.ip)));
      if (wait > 0) {
        const minutes = Math.ceil(wait / 60_000);
        throw new HttpError(429, "TOO_MANY_ATTEMPTS", `Demasiados intentos fallidos. Vuelve a intentarlo en ${minutes} min.`);
      }
    }
    const user = await login(username, password);
    if (limitOn) resetKey(userKey(username));
    const token = await signSession({ sub: user.id, username: user.username });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });

    await recordAudit(req, {
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      actor: { id: user.id, username: user.username },
    });

    const identity = await getIdentity(user.id);
    ok(res, identity);
  } catch (err) {
    // Cuenta solo fallos de credenciales/cuenta (401/403), no bloqueos ni errores internos.
    const status = err instanceof HttpError ? err.status : 0;
    if (limitOn && security && attemptedUser && (status === 401 || status === 403)) {
      const windowMs = security.windowMinutes * 60_000;
      const lockMs = security.lockMinutes * 60_000;
      registerFailure(userKey(attemptedUser), { maxAttempts: security.maxAttemptsPerUser, windowMs, lockMs });
      registerFailure(ipKey(req.ip), { maxAttempts: security.maxAttemptsPerIp, windowMs, lockMs });
    }
    // Auditar intentos fallidos sin exponer detalles.
    if (req.body && typeof req.body === "object" && "username" in req.body) {
      await recordAudit(req, {
        action: "auth.login_failed",
        actor: { id: null, username: String((req.body as { username: unknown }).username ?? "") },
      });
    }
    next(err);
  }
});

authRouter.post("/logout", authenticate, async (req, res, next) => {
  try {
    await recordAudit(req, { action: "auth.logout" });
    res.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: cookieSecure, sameSite: "lax" });
    ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", authenticate, (req, res) => {
  ok(res, req.auth);
});

// Campos omitidos (undefined) NO se tocan; null limpia el valor.
const profileSchema = z.object({
  fullName: z.string().max(255).nullable().optional(),
  email: z.string().email().nullable().optional(),
  preferredLanguage: z.enum(APP_LOCALES).nullable().optional(),
  preferredTheme: z.enum(["dark", "light"]).nullable().optional(),
  // Avatar como data URL de imagen (pequeña); "" o null lo elimina.
  avatar: z
    .string()
    .max(400_000, "La imagen es demasiado grande")
    .refine((v) => v === "" || v.startsWith("data:image/"), "Avatar inválido")
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
});

authRouter.patch("/profile", authenticate, async (req, res, next) => {
  try {
    const data = profileSchema.parse(req.body);
    const user = await updateOwnProfile(req.auth!.user.id, data);
    await recordAudit(req, { action: "profile.update", entityType: "user", entityId: user.id });
    const identity = await getIdentity(user.id);
    ok(res, identity);
  } catch (err) {
    next(err);
  }
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(8).max(1024),
});

authRouter.post("/change-password", authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);
    await changeOwnPassword(req.auth!.user.id, currentPassword, newPassword);
    await recordAudit(req, { action: "profile.change_password", entityType: "user", entityId: req.auth!.user.id });
    ok(res, { changed: true });
  } catch (err) {
    next(err);
  }
});
