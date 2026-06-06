import type { DashboardDto, DashboardExecution, DashboardUpcoming } from "@dbkeeper/shared";
import { query } from "../../db/pool.js";

/** Agrega los datos del Panel en pocas consultas (sin N+1). */
export async function getDashboard(): Promise<DashboardDto> {
  const [servers, jobs, exec, bytes, recent, upcoming] = await Promise.all([
    query<{ n: string }>("SELECT count(*)::text AS n FROM core.servers"),
    query<{ total: string; active: string }>(
      "SELECT count(*)::text AS total, count(*) FILTER (WHERE is_active)::text AS active FROM core.backup_jobs",
    ),
    query<{ total: string; success: string; failed: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'success')::text AS success,
              count(*) FILTER (WHERE status = 'failed')::text AS failed
       FROM core.executions WHERE created_at >= now() - interval '7 days'`,
    ),
    query<{ bytes: string }>(
      `SELECT COALESCE(SUM(i.file_bytes), 0)::text AS bytes
       FROM core.execution_items i
       JOIN core.executions e ON e.id = i.execution_id
       WHERE e.created_at >= now() - interval '7 days' AND i.status = 'success'`,
    ),
    query<{
      id: string;
      label: string;
      status: DashboardExecution["status"];
      environment: string | null;
      finished_at: Date | null;
      bytes: string;
    }>(
      `SELECT e.id, e.label, e.status, e.environment, e.finished_at,
              COALESCE(SUM(i.file_bytes), 0)::text AS bytes
       FROM core.executions e
       LEFT JOIN core.execution_items i ON i.execution_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC
       LIMIT 6`,
    ),
    query<{ job_id: string; name: string; mode: DashboardUpcoming["mode"]; next_run_at: Date }>(
      `SELECT s.job_id, j.name, s.mode, s.next_run_at
       FROM core.backup_schedules s
       JOIN core.backup_jobs j ON j.id = s.job_id
       WHERE s.is_active = true AND s.next_run_at IS NOT NULL
       ORDER BY s.next_run_at ASC
       LIMIT 6`,
    ),
  ]);

  return {
    servers: Number(servers.rows[0]?.n ?? 0),
    jobsTotal: Number(jobs.rows[0]?.total ?? 0),
    jobsActive: Number(jobs.rows[0]?.active ?? 0),
    executions7d: {
      total: Number(exec.rows[0]?.total ?? 0),
      success: Number(exec.rows[0]?.success ?? 0),
      failed: Number(exec.rows[0]?.failed ?? 0),
      bytes: Number(bytes.rows[0]?.bytes ?? 0),
    },
    recent: recent.rows.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      environment: r.environment,
      finishedAt: r.finished_at?.toISOString() ?? null,
      bytes: Number(r.bytes),
    })),
    upcoming: upcoming.rows.map((u) => ({
      jobId: u.job_id,
      jobName: u.name,
      mode: u.mode,
      nextRunAt: u.next_run_at.toISOString(),
    })),
    db: "up",
  };
}
