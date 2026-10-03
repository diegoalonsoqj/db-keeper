import sql from "mssql";

export interface SqlServerBackupInput {
  host: string;
  port: number;
  user: string;
  password: string;
  ssl: boolean;
  dbName: string;
  /** Carpeta en el host de SQL Server donde se escribe el .bak. */
  backupDir: string;
  /** Nombre base del archivo (sin extensión). */
  fileBase: string;
  compress: boolean;
  /** Tope total del BACKUP (corre en el servidor: no hay archivo local que vigilar). */
  maxMs: number;
}

/**
 * Respalda una BD de SQL Server con `BACKUP DATABASE ... TO DISK`. A diferencia de
 * los demás motores, el `.bak` se escribe **en el propio servidor** (no se transmite
 * al cliente), por lo que el destino es una ruta de la instancia. Tras respaldar se
 * valida con `RESTORE VERIFYONLY` y se lee el peso desde `msdb.dbo.backupset`.
 * Devuelve la ruta (en el servidor) y el peso en bytes.
 */
export async function backupSqlServer(
  input: SqlServerBackupInput,
): Promise<{ filePath: string; bytes: number }> {
  const filePath = joinServerPath(input.backupDir, `${input.fileBase}.bak`);
  const pool = new sql.ConnectionPool({
    server: input.host,
    port: input.port,
    user: input.user,
    password: input.password,
    database: "master",
    options: { encrypt: input.ssl, trustServerCertificate: true },
    connectionTimeout: 15_000,
    requestTimeout: input.maxMs,
  });
  await pool.connect();
  try {
    // BACKUP/RESTORE no admiten parámetros para el identificador ni la ruta: se
    // escapan a mano (corchetes con `]]` para el nombre; `''` para la ruta).
    const dbIdent = `[${input.dbName.replace(/]/g, "]]")}]`;
    const pathLit = filePath.replace(/'/g, "''");
    const withOpts = ["FORMAT", "INIT", "CHECKSUM", ...(input.compress ? ["COMPRESSION"] : [])].join(", ");

    await pool.request().query(`BACKUP DATABASE ${dbIdent} TO DISK = N'${pathLit}' WITH ${withOpts}`);
    await pool.request().query(`RESTORE VERIFYONLY FROM DISK = N'${pathLit}'`);

    const meta = await pool
      .request()
      .input("path", sql.NVarChar, filePath)
      .query<{ backup_size: number; compressed_backup_size: number | null }>(
        `SELECT TOP 1 bs.backup_size, bs.compressed_backup_size
         FROM msdb.dbo.backupset bs
         JOIN msdb.dbo.backupmediafamily mf ON mf.media_set_id = bs.media_set_id
         WHERE mf.physical_device_name = @path
         ORDER BY bs.backup_finish_date DESC`,
      );
    const row = meta.recordset[0];
    const bytes = row ? Number(row.compressed_backup_size ?? row.backup_size) : 0;
    return { filePath, bytes };
  } finally {
    await pool.close();
  }
}

/** Une carpeta + archivo respetando el separador aparente de la ruta del servidor. */
function joinServerPath(dir: string, file: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${file}`;
}
