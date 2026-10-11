import { GoogleAuth } from "google-auth-library";

/**
 * Cliente mínimo de la API REST de Compute Engine (v1) para el disco temporal del
 * dump paralelo: crear, adjuntar, desadjuntar, borrar y listar discos. Como en
 * cloudsql.ts, se usa la API y no `gcloud`: sin SDK, sin shell y con errores
 * estructurados.
 *
 * Permisos (rol personalizado; no hace falta compute.instanceAdmin):
 * compute.disks.create/delete/get/list/use/setLabels, compute.instances.attachDisk/
 * detachDisk/get y compute.zoneOperations.get.
 */
const BASE = "https://compute.googleapis.com/compute/v1";
const CRM = "https://cloudresourcemanager.googleapis.com/v1";

const POLL_MIN_MS = 2_000;
const POLL_MAX_MS = 10_000;

/** Permisos que necesita la credencial (los comprueba "Probar configuración"). */
export const SCRATCH_PERMISSIONS = [
  "compute.disks.create",
  "compute.disks.delete",
  "compute.disks.get",
  "compute.disks.list",
  "compute.disks.use",
  "compute.disks.setLabels",
  "compute.instances.attachDisk",
  "compute.instances.detachDisk",
  "compute.instances.get",
  "compute.zoneOperations.get",
];

export interface ComputeTarget {
  /** Clave JSON de la service account; null = Application Default Credentials. */
  serviceAccountJson: string | null;
  project: string;
  zone: string;
}

export class ComputeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ComputeError";
  }
}

const PROJECT_RE = /^[a-z0-9.:-]{4,100}$/;
const ZONE_RE = /^[a-z]+-[a-z]+\d+-[a-z]$/;
/** Nombre de recurso de GCE (disco, VM, device name). */
export const RESOURCE_NAME_RE = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

function zonePath(t: ComputeTarget): string {
  if (!PROJECT_RE.test(t.project)) throw new ComputeError(`ID de proyecto GCP inválido: ${t.project}`, null);
  if (!ZONE_RE.test(t.zone)) throw new ComputeError(`Zona GCP inválida: ${t.zone}`, null);
  return `/projects/${encodeURIComponent(t.project)}/zones/${encodeURIComponent(t.zone)}`;
}

function name(n: string, what: string): string {
  if (!RESOURCE_NAME_RE.test(n)) throw new ComputeError(`Nombre de ${what} inválido: ${n}`, null);
  return encodeURIComponent(n);
}

function auth(serviceAccountJson: string | null): GoogleAuth {
  return new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    ...(serviceAccountJson ? { credentials: JSON.parse(serviceAccountJson) as Record<string, string> } : {}),
  });
}

interface GaxiosLikeError {
  message?: string;
  response?: { status?: number; data?: { error?: { message?: string } } };
}

async function call<T>(
  serviceAccountJson: string | null,
  method: "GET" | "POST" | "DELETE",
  url: string,
  data?: unknown,
): Promise<T> {
  try {
    const client = await auth(serviceAccountJson).getClient();
    const res = await client.request<T>({ url, method, data });
    return res.data;
  } catch (err) {
    const e = err as GaxiosLikeError;
    const status = e.response?.status ?? null;
    const apiMsg = e.response?.data?.error?.message ?? e.message ?? String(err);
    const hint = status === 403 ? " (revisa los permisos de la credencial sobre Compute Engine)" : "";
    throw new ComputeError(`Compute API${status ? ` ${status}` : ""}: ${apiMsg}${hint}`, status);
  }
}

interface Operation {
  name: string;
  status?: "PENDING" | "RUNNING" | "DONE";
  error?: { errors?: { code?: string; message?: string }[] };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Espera a que una operación de zona termine; lanza si falló o se agotó `timeoutMs`. */
async function waitOperation(t: ComputeTarget, op: Operation, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let wait = POLL_MIN_MS;
  while (op.status !== "DONE") {
    if (Date.now() + wait > deadline) {
      throw new ComputeError(`Tiempo de espera agotado en la operación ${op.name} de Compute Engine`, null);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, POLL_MAX_MS);
    // Los nombres de operación pueden superar los 63 caracteres de un recurso.
    if (!/^[a-z0-9-]{1,128}$/.test(op.name)) throw new ComputeError(`Operación inválida: ${op.name}`, null);
    op = await call<Operation>(t.serviceAccountJson, "GET", `${BASE}${zonePath(t)}/operations/${op.name}`);
  }
  const errors = op.error?.errors ?? [];
  if (errors.length > 0) {
    throw new ComputeError(errors.map((e) => [e.code, e.message].filter(Boolean).join(": ")).join("; "), null);
  }
}

export interface DiskInfo {
  name: string;
  sizeGb: number;
  status: string;
  /** URLs de las VMs que lo tienen adjuntado. */
  users: string[];
  labels: Record<string, string>;
}

interface DiskResource {
  name: string;
  sizeGb?: string;
  status?: string;
  users?: string[];
  labels?: Record<string, string>;
}

const toDisk = (d: DiskResource): DiskInfo => ({
  name: d.name,
  sizeGb: Number(d.sizeGb ?? 0),
  status: d.status ?? "UNKNOWN",
  users: d.users ?? [],
  labels: d.labels ?? {},
});

export async function createDisk(
  t: ComputeTarget,
  d: { name: string; sizeGb: number; type: string; labels: Record<string, string> },
  timeoutMs: number,
): Promise<void> {
  const zp = zonePath(t);
  const op = await call<Operation>(t.serviceAccountJson, "POST", `${BASE}${zp}/disks`, {
    name: d.name,
    sizeGb: String(d.sizeGb),
    type: `${zp.slice(1)}/diskTypes/${name(d.type, "tipo de disco")}`,
    labels: d.labels,
  });
  await waitOperation(t, op, timeoutMs);
}

/** Datos del disco, o null si no existe. */
export async function getDisk(t: ComputeTarget, disk: string): Promise<DiskInfo | null> {
  try {
    return toDisk(await call<DiskResource>(t.serviceAccountJson, "GET", `${BASE}${zonePath(t)}/disks/${name(disk, "disco")}`));
  } catch (err) {
    if (err instanceof ComputeError && err.status === 404) return null;
    throw err;
  }
}

/** Discos de la zona con la etiqueta `key=value`. */
export async function listDisksByLabel(t: ComputeTarget, key: string, value: string): Promise<DiskInfo[]> {
  if (!/^[a-z][a-z0-9_-]{0,62}$/.test(key) || !/^[a-z0-9_-]{0,63}$/.test(value)) {
    throw new ComputeError("Etiqueta inválida", null);
  }
  const out: DiskInfo[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ filter: `labels.${key}=${value}`, maxResults: "100" });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await call<{ items?: DiskResource[]; nextPageToken?: string }>(
      t.serviceAccountJson,
      "GET",
      `${BASE}${zonePath(t)}/disks?${qs.toString()}`,
    );
    out.push(...(r.items ?? []).map(toDisk));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

export async function attachDisk(
  t: ComputeTarget,
  instance: string,
  disk: string,
  deviceName: string,
  timeoutMs: number,
): Promise<void> {
  const zp = zonePath(t);
  const op = await call<Operation>(t.serviceAccountJson, "POST", `${BASE}${zp}/instances/${name(instance, "VM")}/attachDisk`, {
    source: `${zp.slice(1)}/disks/${name(disk, "disco")}`,
    deviceName: name(deviceName, "dispositivo"),
    mode: "READ_WRITE",
    autoDelete: false,
  });
  await waitOperation(t, op, timeoutMs);
}

export async function detachDisk(t: ComputeTarget, instance: string, deviceName: string, timeoutMs: number): Promise<void> {
  const url = `${BASE}${zonePath(t)}/instances/${name(instance, "VM")}/detachDisk?deviceName=${name(deviceName, "dispositivo")}`;
  const op = await call<Operation>(t.serviceAccountJson, "POST", url);
  await waitOperation(t, op, timeoutMs);
}

/** Borra el disco; si ya no existe, no hace nada. */
export async function deleteDisk(t: ComputeTarget, disk: string, timeoutMs: number): Promise<void> {
  let op: Operation;
  try {
    op = await call<Operation>(t.serviceAccountJson, "DELETE", `${BASE}${zonePath(t)}/disks/${name(disk, "disco")}`);
  } catch (err) {
    if (err instanceof ComputeError && err.status === 404) return;
    throw err;
  }
  await waitOperation(t, op, timeoutMs);
}

/** Permisos de `permissions` que la credencial NO tiene sobre el proyecto. */
export async function missingProjectPermissions(
  serviceAccountJson: string | null,
  project: string,
  permissions: string[],
): Promise<string[]> {
  if (!PROJECT_RE.test(project)) throw new ComputeError(`ID de proyecto GCP inválido: ${project}`, null);
  const r = await call<{ permissions?: string[] }>(
    serviceAccountJson,
    "POST",
    `${CRM}/projects/${encodeURIComponent(project)}:testIamPermissions`,
    { permissions },
  );
  const granted = new Set(r.permissions ?? []);
  return permissions.filter((p) => !granted.has(p));
}
