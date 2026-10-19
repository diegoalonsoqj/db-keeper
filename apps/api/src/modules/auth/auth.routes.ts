import { Router } from "express";
import { z } from "zod";
import { cookieSecure } from "../../config/env.js";
import { ok } from "../../lib/respond.js";
import { MFA_COOKIE, MFA_TTL_MS, SESSION_COOKIE, signMfaChallenge, signSession, verifyMfaChallenge } from "../../lib/jwt.js";
import { APP_LOCALES, UI_MODES, UI_PALETTES } from "@dbkeeper/shared";
import { authenticate } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import { HttpError } from "../../lib/http-error.js";
import { lockRemainingMs, registerFailure, resetKey } from "../../lib/login-limiter.js";
import { getSecurity } from "../settings/settings.service.js";
import type { Response } from "express";
import { changeOwnPassword, getIdentity, login, requiresTotp, touchLastLogin, updateOwnProfile } from "./auth.service.js";
import * as totp from "./totp.service.js";
import { getSessionVersion, revokeSession } from "./sessions.repository.js";

export const authRouter: Router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});

const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8h, igual que el TTL del JWT

/** Claves del limitador: por usuario (sin distinguir mayúsculas) y por IP. */
const userKey = (u: string) => `user:${u.trim().toLowerCase()}`;
const ipKey = (ip: string | undefined) => `ip:${ip ?? "?"}`;
/** Fallos de código TOTP por usuario: siempre activo (el código es de solo 6 dígitos). */
const mfaKey = (userId: string) => `mfa:${userId}`;
const MFA_POLICY = { maxAttempts: 5, windowMs: 5 * 60_000, lockMs: 15 * 60_000 };

const mfaCookieOpts = { httpOnly: true, secure: cookieSecure, sameSite: "lax" as const, path: "/api/auth" };

/** Emite la cookie de sesión con la versión vigente del usuario (ver sessions.repository). */
async function issueSession(res: Response, userId: string, username: string): Promise<void> {
  const token = await signSession({ sub: userId, username, ver: await getSessionVersion(userId) });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

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

    // Contraseña correcta pero falta el código: desafío corto en cookie, sin sesión.
    if (requiresTotp(user)) {
      res.cookie(MFA_COOKIE, await signMfaChallenge(user.id), { ...mfaCookieOpts, maxAge: MFA_TTL_MS });
      ok(res, { mfaRequired: true });
      return;
    }

    await issueSession(res, user.id, user.username);

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

const totpLoginSchema = z.object({ code: z.string().trim().min(6).max(20) });

/** Segundo paso del login: código de la app o de recuperación. */
authRouter.post("/login/totp", async (req, res, next) => {
  let userId: string | null = null;
  try {
    const { code } = totpLoginSchema.parse(req.body);
    const challenge = (req.cookies as Record<string, string> | undefined)?.[MFA_COOKIE];
    userId = challenge ? await verifyMfaChallenge(challenge) : null;
    if (!userId) throw new HttpError(401, "MFA_EXPIRED", "La verificación venció. Vuelve a ingresar tu contraseña.");

    const wait = lockRemainingMs(mfaKey(userId));
    if (wait > 0) {
      throw new HttpError(429, "TOO_MANY_ATTEMPTS", `Demasiados códigos incorrectos. Vuelve a intentarlo en ${Math.ceil(wait / 60_000)} min.`);
    }
    const identity = await getIdentity(userId);
    if (!identity) throw new HttpError(401, "MFA_EXPIRED", "La verificación venció. Vuelve a ingresar tu contraseña.");
    const method = await totp.verifySecondFactor(userId, code);
    if (!method) {
      registerFailure(mfaKey(userId), MFA_POLICY);
      await recordAudit(req, {
        action: "auth.mfa_failed",
        entityType: "user",
        entityId: userId,
        actor: { id: userId, username: identity.user.username },
      });
      throw HttpError.unauthorized("Código incorrecto");
    }

    resetKey(mfaKey(userId));
    res.clearCookie(MFA_COOKIE, mfaCookieOpts);
    await issueSession(res, userId, identity.user.username);
    await touchLastLogin(userId);
    await recordAudit(req, {
      action: "auth.login",
      entityType: "user",
      entityId: userId,
      detail: { mfa: method },
      actor: { id: userId, username: identity.user.username },
    });
    ok(res, identity);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", authenticate, async (req, res, next) => {
  try {
    await recordAudit(req, { action: "auth.logout" });
    // Sin esto el token seguiría valiendo hasta vencer aunque se borre la cookie.
    const s = req.session!;
    if (s.jti) await revokeSession(s.jti, new Date(s.exp * 1000));
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
  preferredTheme: z.enum(UI_MODES).nullable().optional(),
  preferredPalette: z.enum(UI_PALETTES).nullable().optional(),
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
    // Las demás sesiones quedaron revocadas; esta sigue con un token nuevo.
    await issueSession(res, req.auth!.user.id, req.auth!.user.username);
    await recordAudit(req, { action: "profile.change_password", entityType: "user", entityId: req.auth!.user.id });
    ok(res, { changed: true });
  } catch (err) {
    next(err);
  }
});

// ---- Segundo factor del propio usuario ----

authRouter.get("/totp", authenticate, async (req, res, next) => {
  try {
    const u = req.auth!.user;
    ok(res, { enabled: u.totpEnabled, recoveryCodesLeft: u.totpEnabled ? await totp.recoveryCodesLeft(u.id) : 0 });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/totp/setup", authenticate, async (req, res, next) => {
  try {
    ok(res, await totp.startTotpSetup(req.auth!.user.id));
  } catch (err) {
    next(err);
  }
});

const totpCodeSchema = z.object({ code: z.string().trim().min(6).max(20) });

authRouter.post("/totp/enable", authenticate, async (req, res, next) => {
  try {
    const { code } = totpCodeSchema.parse(req.body);
    const recoveryCodes = await totp.confirmTotpSetup(req.auth!.user.id, code);
    await issueSession(res, req.auth!.user.id, req.auth!.user.username);
    await recordAudit(req, { action: "profile.totp_enable", entityType: "user", entityId: req.auth!.user.id });
    ok(res, { recoveryCodes });
  } catch (err) {
    next(err);
  }
});

const totpDisableSchema = totpCodeSchema.extend({ password: z.string().min(1).max(1024) });

authRouter.post("/totp/disable", authenticate, async (req, res, next) => {
  try {
    const { code, password } = totpDisableSchema.parse(req.body);
    await totp.disableOwnTotp(req.auth!.user.id, password, code);
    await issueSession(res, req.auth!.user.id, req.auth!.user.username);
    await recordAudit(req, { action: "profile.totp_disable", entityType: "user", entityId: req.auth!.user.id });
    ok(res, { disabled: true });
  } catch (err) {
    next(err);
  }
});
