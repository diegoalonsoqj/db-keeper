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

/** Sube un archivo local a `gs://bucket/objectName`. Devuelve la URI `gs://`. */
export async function uploadToGcs(
  auth: GcsAuth,
  localPath: string,
  objectName: string,
): Promise<string> {
  const storage = client(auth.serviceAccountJson);
  await storage.bucket(auth.bucket).upload(localPath, { destination: objectName, resumable: true });
  return `gs://${auth.bucket}/${objectName}`;
}

/** Stream de lectura de un objeto GCS (para descarga vía la API). */
export function gcsReadStream(auth: GcsAuth, objectName: string): Readable {
  return client(auth.serviceAccountJson).bucket(auth.bucket).file(objectName).createReadStream();
}

/** Parsea `gs://bucket/objeto` → `{ bucket, object }` (o null). */
export function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  return m ? { bucket: m[1]!, object: m[2]! } : null;
}
