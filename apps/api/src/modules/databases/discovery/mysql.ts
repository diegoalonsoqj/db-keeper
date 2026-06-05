import mysql from "mysql2/promise";
import { DISCOVER_TIMEOUT_MS, type ConnInfo } from "./types.js";

const SYSTEM = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export async function discoverMysql(conn: ConnInfo): Promise<string[]> {
  const connection = await mysql.createConnection({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: DISCOVER_TIMEOUT_MS,
  });
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SHOW DATABASES");
    return rows
      .map((r) => String(r.Database))
      .filter((n) => !SYSTEM.has(n))
      .sort();
  } finally {
    await connection.end();
  }
}
