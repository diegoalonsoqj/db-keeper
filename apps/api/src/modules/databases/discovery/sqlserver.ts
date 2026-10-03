import sql from "mssql";
import type { DiscoveredDatabase } from "@dbkeeper/shared";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

export async function discoverSqlServer(conn: ConnInfo): Promise<DiscoveredDatabase[]> {
  const pool = new sql.ConnectionPool({
    server: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: "master",
    options: { encrypt: conn.ssl, trustServerCertificate: true },
    connectionTimeout: DISCOVER_TIMEOUT_MS,
    requestTimeout: DISCOVER_TIMEOUT_MS,
  });
  await pool.connect();
  try {
    // database_id > 4 excluye master, tempdb, model y msdb (las del sistema). Tamaño =
    // archivos de datos (sin el log, que no va al backup completo); sys.master_files
    // exige VIEW ANY DEFINITION: sin ese permiso el tamaño queda null.
    const res = await pool.request().query<{ name: string; bytes: string | number | null }>(
      `SELECT d.name, SUM(CAST(mf.size AS bigint)) * 8192 AS bytes
       FROM sys.databases d
       LEFT JOIN sys.master_files mf ON mf.database_id = d.database_id AND mf.type = 0
       WHERE d.database_id > 4
       GROUP BY d.name
       ORDER BY d.name`,
    );
    return res.recordset.map((r) => ({ name: r.name, bytes: r.bytes === null ? null : Number(r.bytes) }));
  } finally {
    await pool.close();
  }
}
