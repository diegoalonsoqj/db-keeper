import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ok } from "../../lib/respond.js";
import { SESSION_COOKIE, signSession } from "../../lib/jwt.js";
import { authenticate } from "../../middleware/auth.js";
import { recordAudit } from "../audit/audit.service.js";
import { getIdentity, login } from "./auth.service.js";

export const authRouter: Router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});

const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8h, igual que el TTL del JWT

authRouter.post("/login", async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const user = await login(username, password);
    const token = await signSession({ sub: user.id, username: user.username });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.APP_ENV === "production",
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
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    ok(res, { loggedOut: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", authenticate, (req, res) => {
  ok(res, req.auth);
});
