import type { BucketDto, StorageProvider } from "@dbkeeper/shared";
import { HttpError } from "../../lib/http-error.js";
import { encryptSecret } from "../../lib/crypto.js";
import * as repo from "./buckets.repository.js";

export async function listBuckets(p: { limit: number; offset: number }) {
  return repo.listBuckets(p);
}

export async function getBucket(id: string): Promise<BucketDto> {
  const b = await repo.findById(id);
  if (!b) throw HttpError.notFound("Bucket no encontrado");
  return b;
}

export interface BucketData {
  name: string;
  provider: StorageProvider;
  bucket: string;
  prefix: string | null;
  isActive: boolean;
}

/** `serviceAccount` es el JSON de la clave de servicio GCP (se cifra). */
export async function createBucket(data: BucketData, serviceAccount?: string | null): Promise<BucketDto> {
  if (await repo.findByName(data.name)) {
    throw HttpError.conflict("Ya existe un bucket con ese nombre");
  }
  const enc = serviceAccount ? encryptSecret(serviceAccount) : null;
  const id = await repo.insertBucket(data, enc);
  return getBucket(id);
}

export async function updateBucket(
  id: string,
  data: Partial<BucketData>,
  serviceAccount?: string | null,
): Promise<BucketDto> {
  const existing = await repo.findById(id);
  if (!existing) throw HttpError.notFound("Bucket no encontrado");

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await repo.findByName(data.name);
    if (dup && dup.id !== id) throw HttpError.conflict("Ya existe un bucket con ese nombre");
  }

  // undefined = no tocar la clave; "" = borrarla; texto = cifrar y reemplazar.
  let encArg: string | null | undefined;
  if (serviceAccount !== undefined) encArg = serviceAccount ? encryptSecret(serviceAccount) : null;

  await repo.updateBucket(id, data, encArg);
  return getBucket(id);
}

export async function deleteBucket(id: string): Promise<void> {
  const b = await repo.findById(id);
  if (!b) throw HttpError.notFound("Bucket no encontrado");
  await repo.deleteBucket(id);
}
