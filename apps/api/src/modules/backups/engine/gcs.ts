import type { Readable } from "node:stream";
import { Storage } from "@google-cloud/storage";

/** Cliente de GCS: usa la service account (en memoria) o ADC si no hay clave. */
function client(serviceAccountJson: string | null): Storage {
  if (serviceAccountJson) {
    return new Storage({ credentials: JSON.parse(serviceAccountJson) as Record<string, unknown> });
  }
  return new Storage(); // Application Default Credentials
}

export interface GcsAuth {
  bucket: string;
  serviceAccountJson: string | null;
}

/**
 * Sube un archivo local a `gs://bucket/objectName`. Devuelve la URI `gs://`.
 * `customMetadata` se guarda como metadata del objeto (p. ej. `sha256`).
 */
export async function uploadToGcs(
  auth: GcsAuth,
  localPath: string,
  objectName: string,
  customMetadata?: Record<string, string>,
): Promise<string> {
  const storage = client(auth.serviceAccountJson);
  await storage.bucket(auth.bucket).upload(localPath, {
    destination: objectName,
    resumable: true,
    validation: "crc32c",
    metadata: customMetadata ? { metadata: customMetadata } : undefined,
  });
  return `gs://${auth.bucket}/${objectName}`;
}

/** Stream de lectura de un objeto GCS (para descarga vía la API). */
export function gcsReadStream(auth: GcsAuth, objectName: string): Readable {
  return client(auth.serviceAccountJson).bucket(auth.bucket).file(objectName).createReadStream();
}

export interface GcsObjectInfo {
  bytes: number;
  /** Base64, tal como lo da GCS; null en objetos compuestos. */
  md5: string | null;
  /** Base64, tal como lo da GCS. */
  crc32c: string | null;
}

/** Peso y checksums de un objeto de GCS (lanza si no existe). */
export async function getGcsObjectInfo(auth: GcsAuth, objectName: string): Promise<GcsObjectInfo> {
  const [meta] = await client(auth.serviceAccountJson).bucket(auth.bucket).file(objectName).getMetadata();
  return { bytes: Number(meta.size ?? 0), md5: meta.md5Hash ?? null, crc32c: meta.crc32c ?? null };
}

/** Parsea `gs://bucket/objeto` → `{ bucket, object }` (o null). */
export function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  return m ? { bucket: m[1]!, object: m[2]! } : null;
}
