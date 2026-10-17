import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CRC32C } from "@google-cloud/storage";
import { formatDuration, PGDIR_MANIFEST } from "@dbkeeper/shared";
import { formatBytes } from "../../../lib/format.js";
import { gcsClient, type GcsAuth } from "./gcs.js";

/** Formato del manifiesto (versionado por si cambia la estructura). */
export const MANIFEST_FORMAT = "dbkeeper-pgdir/1";

/** Archivos chicos se suben en una sola petición; los grandes, reanudables. */
const RESUMABLE_MIN_BYTES = 16 * 1024 * 1024;
const PROGRESS_LOG_MS = 60_000;

export interface ManifestFile {
  /** Ruta relativa dentro de la carpeta del backup (con `/`). */
  name: string;
  bytes: number;
  sha256: string;
  md5: string;
  /** Base64, formato de GCS. */
  crc32c: string;
}

export interface Manifest {
  format: string;
  createdAt: string;
  files: ManifestFile[];
  [extra: string]: unknown;
}

export interface DirUploadResult {
  /** URI del prefijo, terminada en `/` (así se reconoce un backup directorio). */
  uri: string;
  bytes: number;
  files: number;
  /** Checksums del manifest.json (huella de todo el backup). */
  manifest: { sha256: string; md5: string; crc32c: string };
}

/** Archivos de la carpeta con su ruta relativa POSIX. */
export async function listFiles(root: string, rel = ""): Promise<{ abs: string; rel: string; bytes: number }[]> {
  const out: { abs: string; rel: string; bytes: number }[] = [];
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(root, r)));
    else if (e.isFile()) out.push({ abs: path.join(root, r), rel: r, bytes: (await stat(path.join(root, r))).size });
  }
  return out;
}

/** Hashes de un buffer (para el manifiesto). */
function hashBuffer(buf: Buffer): { sha256: string; md5: string; crc32c: string } {
  const crc = new CRC32C();
  crc.update(buf);
  return {
    sha256: createHash("sha256").update(buf).digest("hex"),
    md5: createHash("md5").update(buf).digest("hex"),
    crc32c: crc.toString(),
  };
}

/**
 * Compara lo subido (listado del bucket) con lo calculado localmente. Devuelve las
 * diferencias (vacío = todo coincide).
 */
export function diffUploaded(
  expected: { name: string; bytes: number; crc32c: string }[],
  actual: Map<string, { bytes: number; crc32c: string | null }>,
): string[] {
  const diffs: string[] = [];
  for (const f of expected) {
    const a = actual.get(f.name);
    if (!a) diffs.push(`${f.name}: no está en el bucket`);
    else if (a.bytes !== f.bytes) diffs.push(`${f.name}: ${a.bytes} bytes en el bucket, ${f.bytes} locales`);
    else if (a.crc32c !== f.crc32c) diffs.push(`${f.name}: CRC32C ${a.crc32c ?? "?"} en el bucket, ${f.crc32c} local`);
  }
  return diffs;
}

/**
 * Sube una carpeta a `gs://bucket/<prefix>/` con `concurrency` archivos a la vez,
 * calculando SHA-256/MD5/CRC32C al vuelo (una sola lectura del disco). Luego
 * compara cada objeto del bucket con lo calculado y, si todo coincide, sube
 * `manifest.json`: su presencia marca el backup como completo. Si algo falla,
 * los objetos ya subidos quedan sin manifiesto (la app no borra objetos de buckets).
 */
export async function uploadDirectoryToGcs(
  auth: GcsAuth,
  localDir: string,
  prefix: string,
  opts: {
    concurrency: number;
    manifestExtra: Record<string, unknown>;
    onLog?: (line: string) => void;
    signal?: AbortSignal;
  },
): Promise<DirUploadResult> {
  const bucket = gcsClient(auth.serviceAccountJson).bucket(auth.bucket);
  const files = await listFiles(localDir);
  if (files.find((f) => f.rel === PGDIR_MANIFEST)) throw new Error(`La carpeta ya contiene ${PGDIR_MANIFEST}`);
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const log = opts.onLog ?? (() => {});
  log(`Subiendo ${files.length} archivos (${formatBytes(total)}) a gs://${auth.bucket}/${prefix}/ con ${opts.concurrency} en paralelo…`);

  const done: ManifestFile[] = [];
  let uploadedBytes = 0;
  let nextLog = Date.now() + PROGRESS_LOG_MS;
  const start = Date.now();

  const uploadOne = async (f: { abs: string; rel: string; bytes: number }): Promise<void> => {
    const sha = createHash("sha256");
    const md5 = createHash("md5");
    const crc = new CRC32C();
    const hasher = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sha.update(chunk);
        md5.update(chunk);
        crc.update(chunk);
        cb(null, chunk);
      },
    });
    const dest = bucket.file(`${prefix}/${f.rel}`).createWriteStream({
      resumable: f.bytes >= RESUMABLE_MIN_BYTES,
      validation: "crc32c",
      metadata: { contentType: "application/octet-stream" },
    });
    await pipeline(createReadStream(f.abs), hasher, dest, { signal: opts.signal });
    done.push({ name: f.rel, bytes: f.bytes, sha256: sha.digest("hex"), md5: md5.digest("hex"), crc32c: crc.toString() });
    uploadedBytes += f.bytes;
    if (Date.now() >= nextLog) {
      nextLog = Date.now() + PROGRESS_LOG_MS;
      log(`Subidos ${done.length}/${files.length} archivos (${formatBytes(uploadedBytes)} de ${formatBytes(total)})…`);
    }
  };

  // Pool de N workers: los archivos grandes primero (el más grande marca la duración).
  const queue = [...files].sort((a, b) => b.bytes - a.bytes);
  let failed = false; // un fallo detiene a los demás workers (no toman más archivos)
  const worker = async (): Promise<void> => {
    for (let f = queue.shift(); f && !failed; f = queue.shift()) {
      if (opts.signal?.aborted) throw new Error("Cancelada");
      try {
        await uploadOne(f);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  // allSettled: no se devuelve el error mientras otro worker siga subiendo.
  const results = await Promise.allSettled(Array.from({ length: Math.min(opts.concurrency, files.length) }, worker));
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (rejected) throw opts.signal?.aborted ? new Error("Cancelada") : rejected.reason;
  log(`Subida completada en ${formatDuration(Date.now() - start)}. Verificando objetos en el bucket…`);

  // Verificación: tamaño y CRC32C de cada objeto contra lo calculado al subir.
  const [objects] = await bucket.getFiles({ prefix: `${prefix}/`, autoPaginate: true });
  const actual = new Map(
    objects.map((o) => [
      o.name.slice(prefix.length + 1),
      { bytes: Number(o.metadata.size ?? -1), crc32c: o.metadata.crc32c ?? null },
    ]),
  );
  const diffs = diffUploaded(done, actual);
  if (diffs.length > 0) {
    throw new Error(`Integridad fallida en el bucket (${diffs.length} archivos):\n${diffs.slice(0, 20).join("\n")}`);
  }
  log(`Integridad verificada: ${done.length} objetos coinciden (tamaño y CRC32C).`);

  const manifest: Manifest = {
    format: MANIFEST_FORMAT,
    createdAt: new Date().toISOString(),
    ...opts.manifestExtra,
    files: done.sort((a, b) => a.name.localeCompare(b.name)),
  };
  const buf = Buffer.from(JSON.stringify(manifest, null, 2));
  const mh = hashBuffer(buf);
  const mFile = bucket.file(`${prefix}/${PGDIR_MANIFEST}`);
  await mFile.save(buf, { resumable: false, validation: "crc32c", contentType: "application/json" });
  const [meta] = await mFile.getMetadata();
  if (meta.crc32c !== mh.crc32c) throw new Error(`Integridad fallida en ${PGDIR_MANIFEST} (CRC32C ${meta.crc32c} vs ${mh.crc32c})`);
  log(`${PGDIR_MANIFEST} subido (SHA-256 ${mh.sha256}).`);

  return { uri: `gs://${auth.bucket}/${prefix}/`, bytes: total, files: done.length, manifest: mh };
}

/** Lee y parsea el manifiesto de un backup directorio (`gs://bucket/prefijo/`). */
export async function readManifest(auth: GcsAuth, prefix: string): Promise<{ manifest: Manifest; raw: Buffer }> {
  const [raw] = await gcsClient(auth.serviceAccountJson).bucket(auth.bucket).file(`${prefix}/${PGDIR_MANIFEST}`).download();
  const manifest = JSON.parse(raw.toString("utf8")) as Manifest;
  if (!Array.isArray(manifest.files)) throw new Error(`${PGDIR_MANIFEST} inválido: sin lista de archivos`);
  return { manifest, raw };
}

/** Tamaño y CRC32C de los objetos bajo `prefix/` (sin el manifiesto). */
export async function listPrefixObjects(
  auth: GcsAuth,
  prefix: string,
): Promise<Map<string, { bytes: number; crc32c: string | null }>> {
  const [objects] = await gcsClient(auth.serviceAccountJson).bucket(auth.bucket).getFiles({ prefix: `${prefix}/`, autoPaginate: true });
  return new Map(
    objects
      .map((o) => [o.name.slice(prefix.length + 1), { bytes: Number(o.metadata.size ?? -1), crc32c: o.metadata.crc32c ?? null }] as const)
      .filter(([n]) => n !== PGDIR_MANIFEST),
  );
}

export { hashBuffer };
