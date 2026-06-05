import sql from "mssql";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

export async function discoverSqlServer(conn: ConnInfo): Promise<string[]> {
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
    // database_id > 4 excluye master, tempdb, model y msdb (las del sistema).
    const res = await pool
      .request()
      .query<{ name: string }>("SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name");
    return res.recordset.map((r) => r.name);
  } finally {
    await pool.close();
  }
}
