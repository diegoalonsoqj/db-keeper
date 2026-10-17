import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";

/**
 * Tokens de sesión (JWT HS256) firmados con APP_SECRET_KEY.
 * El token viaja en una cookie httpOnly; el payload solo lleva identidad mínima,
 * los permisos se resuelven en cada request desde la BD (fuente de verdad).
 */
const secret = new TextEncoder().encode(env.APP_SECRET_KEY);
const ISSUER = "dbkeeper";
const TTL = "8h";

export const SESSION_COOKIE = "dbk_session";

export interface SessionClaims {
  sub: string; // user id
  username: string;
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ username: claims.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    if (!payload.sub || typeof payload.username !== "string") return null;
    return { sub: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

// ---- Desafío de segundo factor ----
// Token corto entre la contraseña y el código TOTP. Otro emisor: verifySession lo
// rechaza, así que no sirve como sesión aunque se firme con la misma clave.
const MFA_ISSUER = "dbkeeper-mfa";
export const MFA_COOKIE = "dbk_mfa";
export const MFA_TTL_MS = 5 * 60 * 1000;

export async function signMfaChallenge(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(MFA_ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + MFA_TTL_MS) / 1000))
    .sign(secret);
}

/** Id del usuario del desafío, o null si el token no vale o venció. */
export async function verifyMfaChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: MFA_ISSUER });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
