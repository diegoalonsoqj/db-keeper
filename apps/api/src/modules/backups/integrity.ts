import { createReadStream } from "node:fs";
import type { ExecutionDto, VerifyMode } from "@dbkeeper/shared";
import { logger } from "../../config/logger.js";
import { HttpError } from "../../lib/http-error.js";
import * as storageRepo from "../storage/storage.repository.js";
import { getServiceAccountJson } from "../cloud-credentials/cloud-credentials.service.js";
import { notifyBackup } from "../notifications/notifications.service.js";
import * as repo from "./backups.repository.js";
import type { ItemForVerify } from "./backups.repository.js";
import { compareChecksums, hashStream, md5Base64ToHex } from "./engine/checksum.js";
import { resolveBackupFile } from "./engine/files.js";
import { gcsReadStream, getGcsObjectInfo, parseGcsUri, type GcsAuth } from "./engine/gcs.js";
import { emitExecution } from "./events.js";

type Outcome = { status: "ok" | "mismatch" | "missing"; detail: string | null };

/**
 * "Verificar ahora": relee el archivo de un ítem y compara su huella con la
 * registrada al generarlo. Valida y marca `running` de forma síncrona; la
 * verificación corre en segundo plano y su resultado llega por SSE.
 * Disco local: siempre relee el archivo (el modo se fuerza a `deep`).
 */
export async function verifyItemNow(executionId: string, itemId: string, mode: VerifyMode): Promise<ExecutionDto> {
  const item = await repo.findItemForVerify(executionId, itemId);
  if (!item) throw HttpError.notFound("Ítem de ejecución no encontrado");
  if (item.status !== "success" || !item.fileName) throw HttpError.badRequest("Esta base de datos no generó un archivo");
  if (item.prunedAt) throw HttpError.badRequest("El backup se eliminó por la política de retención");
  const { sha256, md5, crc32c } = item.checksums;
  if (!sha256 && !md5 && !crc32c) {
    throw HttpError.badRequest("Este backup no tiene checksums registrados (es anterior a la función)");
  }
  const isGcs = item.fileName.startsWith("gs://");
  const effective: VerifyMode = isGcs ? mode : "deep";

  if (!(await repo.startItemVerify(itemId, effective))) {
    throw HttpError.conflict("Ya hay una verificación en curso para este archivo");
  }
  await emitExecution(executionId);

  void (async () => {
    try {
      const out = await run(item, isGcs, effective);
      await repo.finishItemVerify(itemId, out.status, out.detail);
      if (out.status !== "ok") alert(item, out);
    } catch (err) {
      logger.error({ err, executionId, itemId }, "Fallo al verificar la integridad del backup");
      const msg = err instanceof Error ? err.message : String(err);
      await repo.finishItemVerify(itemId, "error", msg.slice(0, 500)).catch(() => {});
    }
    await emitExecution(executionId);
  })();

  const exec = await repo.findExecutionById(executionId);
  if (!exec) throw HttpError.notFound("Ejecución no encontrada");
  return exec;
}

async function run(item: ItemForVerify, isGcs: boolean, mode: VerifyMode): Promise<Outcome> {
  if (!isGcs) {
    let stream;
    try {
      const filePath = resolveBackupFile(item.fileName!);
      stream = createReadStream(filePath);
      // Abrir antes de hashear para distinguir "no existe" de un error de lectura.
      await new Promise<void>((resolve, reject) => stream!.once("open", () => resolve()).once("error", reject));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", detail: "El archivo ya no existe en disco" };
      throw err;
    }
    return judge(item, await hashStream(stream));
  }

  const parsed = parseGcsUri(item.fileName!);
  if (!parsed) throw new Error("URI de backup inválida");
  const target = await storageRepo.findBucketByName(parsed.bucket);
  const auth: GcsAuth = {
    bucket: parsed.bucket,
    serviceAccountJson: target?.cloudCredentialId ? await getServiceAccountJson(target.cloudCredentialId) : null,
  };

  let info;
  try {
    info = await getGcsObjectInfo(auth, parsed.object);
  } catch (err) {
    if ((err as { code?: number }).code === 404) return { status: "missing", detail: "El objeto ya no existe en el bucket" };
    throw err;
  }
  if (item.fileBytes != null && info.bytes !== item.fileBytes) {
    return { status: "mismatch", detail: `Tamaño: esperado ${item.fileBytes} bytes, actual ${info.bytes}` };
  }
  if (mode === "quick") return judge(item, { md5: md5Base64ToHex(info.md5), crc32c: info.crc32c });

  try {
    return judge(item, await hashStream(gcsReadStream(auth, parsed.object)));
  } catch (err) {
    // La librería valida la descarga contra el hash del objeto y lanza si difiere.
    if ((err as { code?: string }).code === "CONTENT_DOWNLOAD_MISMATCH") {
      return { status: "mismatch", detail: "El contenido descargado no coincide con el hash del objeto en GCS" };
    }
    throw err;
  }
}

function judge(item: ItemForVerify, actual: Parameters<typeof compareChecksums>[1]): Outcome {
  const { compared, diffs } = compareChecksums(item.checksums, actual);
  if (compared === 0) throw new Error("No hay un checksum comparable con los registrados");
  return diffs.length ? { status: "mismatch", detail: diffs.join("\n") } : { status: "ok", detail: null };
}

/** Aviso por los canales configurados cuando el archivo cambió o desapareció. */
function alert(item: ItemForVerify, out: Outcome): void {
  void notifyBackup({
    event: "integrity",
    jobName: item.jobName,
    engine: item.engine ?? "",
    databases: [item.dbName],
    storage: item.fileName,
    items: [
      {
        dbName: item.dbName,
        status: "failed",
        error: `${out.status === "missing" ? "Archivo faltante" : "No coincide"}${out.detail ? ` — ${out.detail}` : ""}`,
      },
    ],
  });
}
