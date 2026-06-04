import type { Request } from "express";
import { logger } from "../../config/logger.js";
import * as auditRepo from "./audit.repository.js";
import type { AuditQuery } from "./audit.repository.js";

/** Extrae la IP del cliente respetando proxies (X-Forwarded-For). */
function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0]!.trim();
  return req.ip ?? req.socket.remoteAddress ?? null;
}

/**
 * Registra una acción de usuario en la auditoría. Nunca debe tumbar la request:
 * si falla el insert, se loguea y se continúa.
 */
export async function recordAudit(
  req: Request,
  entry: {
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    detail?: unknown;
    // Permite registrar el actor en acciones sin sesión (ej. login).
    actor?: { id: string | null; username: string | null };
  },
): Promise<void> {
  const actor = entry.actor ?? {
    id: req.auth?.user.id ?? null,
    username: req.auth?.user.username ?? null,
  };
  try {
    await auditRepo.insertAudit({
      userId: actor.id,
      username: actor.username,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] ?? null,
      detail: entry.detail,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "No se pudo registrar auditoría");
  }
}

export const listAudit = (q: AuditQuery) => auditRepo.listAudit(q);
