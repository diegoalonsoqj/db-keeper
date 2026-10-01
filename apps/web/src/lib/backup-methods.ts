import type { BackupMethod } from "@dbkeeper/shared";

/** Clave i18n de la etiqueta legible de cada método de backup. */
export const METHOD_LABELS: Record<BackupMethod, string> = {
  dump: "backups.methodDump",
  gcloud: "backups.methodGcloud",
  cloudsql_export: "backups.methodCloudSqlExport",
};
