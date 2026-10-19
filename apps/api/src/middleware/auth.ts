import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuthIdentity, PermissionKey } from "@dbkeeper/shared";
import { HttpError } from "../lib/http-error.js";
import { SESSION_COOKIE, verifySession, type VerifiedSession } from "../lib/jwt.js";
import { getIdentity } from "../modules/auth/auth.service.js";
import { isSessionRevoked } from "../modules/auth/sessions.repository.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthIdentity;
      session?: VerifiedSession;
    }
  }
}

/**
 * Verifica la cookie de sesión, resuelve la identidad (usuario + permisos) desde
 * la BD y la adjunta a req.auth. Falla con 401 si no hay sesión válida.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw HttpError.unauthorized();

    const claims = await verifySession(token);
    if (!claims) throw HttpError.unauthorized("Sesión inválida o expirada");
    if (await isSessionRevoked(claims.sub, claims.ver, claims.jti)) {
      throw HttpError.unauthorized("Sesión inválida o expirada");
    }

    const identity = await getIdentity(claims.sub);
    if (!identity) throw HttpError.unauthorized("Sesión inválida o expirada");

    req.auth = identity;
    req.session = claims;
    next();
  } catch (err) {
    next(err);
  }
};

/** Exige uno o más permisos (todos requeridos). Usar tras `authenticate`. */
export function authorize(...required: PermissionKey[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(HttpError.unauthorized());
    const granted = new Set(req.auth.permissions);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      return next(HttpError.forbidden(`Faltan permisos: ${missing.join(", ")}`));
    }
    next();
  };
}
