import type { AuditEntryDto } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

interface AuditRow {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  detail: unknown;
  created_at: Date;
}

export interface AuditWriteInput {
  userId: string | null;
  username: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detail?: unknown;
}

export async function insertAudit(input: AuditWriteInput): Promise<void> {
  await query(
    `INSERT INTO audit.activity_log
       (user_id, username, action, entity_type, entity_id, ip, user_agent, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.userId,
      input.username,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      input.detail === undefined ? null : JSON.stringify(input.detail),
    ],
  );
}

export interface AuditQuery {
  limit: number;
  offset: number;
  action?: string;
  entityType?: string;
  username?: string;
  from?: Date;
  to?: Date;
}

export async function listAudit(
  q: AuditQuery,
): Promise<{ items: AuditEntryDto[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (q.action) (where.push(`action = $${i++}`), params.push(q.action));
  if (q.entityType) (where.push(`entity_type = $${i++}`), params.push(q.entityType));
  if (q.username) (where.push(`username ILIKE $${i++}`), params.push(`%${q.username}%`));
  if (q.from) (where.push(`created_at >= $${i++}`), params.push(q.from));
  // `to` se interpreta como día inclusivo: hasta el final de esa fecha.
  if (q.to) (where.push(`created_at < $${i++}::timestamptz + interval '1 day'`), params.push(q.to));
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRes = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit.activity_log ${whereSql}`,
    params,
  );
  const total = Number(totalRes.rows[0]?.count ?? 0);

  const { rows } = await query<AuditRow>(
    `SELECT id, user_id, username, action, entity_type, entity_id, ip, detail, created_at
     FROM audit.activity_log ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i}`,
    [...params, q.limit, q.offset],
  );

  const items: AuditEntryDto[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: r.username,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    ip: r.ip,
    detail: r.detail,
    createdAt: r.created_at.toISOString(),
  }));

  return { items, total };
}
