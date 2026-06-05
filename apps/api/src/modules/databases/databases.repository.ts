import type { DatabaseDto } from "@dbkeeper/shared";
import { pool, query } from "../../db/pool.js";

interface DatabaseRow {
  id: string;
  server_id: string;
  name: string;
  schemas: string[] | null;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: DatabaseRow): DatabaseDto {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    schemas: row.schemas,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listByServer(serverId: string): Promise<DatabaseDto[]> {
  const { rows } = await query<DatabaseRow>(
    "SELECT * FROM core.databases WHERE server_id = $1 ORDER BY name",
    [serverId],
  );
  return rows.map(toDto);
}

/**
 * Reemplaza la selección de BDs de una instancia por el conjunto `names`.
 * Borrado + alta en una transacción (la columna `schemas` aún no se usa).
 */
export async function setSelection(serverId: string, names: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM core.databases WHERE server_id = $1", [serverId]);
    if (names.length > 0) {
      await client.query(
        `INSERT INTO core.databases (server_id, name)
         SELECT $1, n FROM unnest($2::text[]) AS n`,
        [serverId, names],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
