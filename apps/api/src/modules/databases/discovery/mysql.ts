import mysql from "mysql2/promise";
import type { DiscoveredDatabase } from "@dbkeeper/shared";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

const SYSTEM = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export async function discoverMysql(conn: ConnInfo): Promise<DiscoveredDatabase[]> {
  const connection = await mysql.createConnection({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: DISCOVER_TIMEOUT_MS,
  });
  try {
    // SCHEMATA lista las mismas BDs que SHOW DATABASES; el tamaño es datos + índices
    // de las tablas que el usuario puede ver (null si no ve ninguna).
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT s.SCHEMA_NAME AS name, SUM(t.DATA_LENGTH + t.INDEX_LENGTH) AS bytes
       FROM information_schema.SCHEMATA s
       LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
       GROUP BY s.SCHEMA_NAME
       ORDER BY s.SCHEMA_NAME`,
    );
    return rows
      .map((r) => ({ name: String(r.name), bytes: r.bytes === null ? null : Number(r.bytes) }))
      .filter((d) => !SYSTEM.has(d.name));
  } finally {
    await connection.end();
  }
}
