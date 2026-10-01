/**
 * Detección de la identidad de la VM de Compute Engine donde corre DBKeeper, vía el
 * servidor de metadatos (solo accesible desde dentro de la VM). Se usa la IP fija
 * en vez de `metadata.google.internal` para no depender del DNS; fuera de GCE la
 * conexión falla rápido y se informa "no disponible".
 */
const METADATA = "http://169.254.169.254/computeMetadata/v1";
const TIMEOUT_MS = 1_500;
/** El resultado se cachea: la identidad de la VM no cambia sin reiniciarla. */
const CACHE_MS = 60_000;

const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
/** Capacidad que usa DBKeeper → scopes que la habilitan (además de cloud-platform). */
const REQUIRED: Record<string, string[]> = {
  "Cloud Storage (lectura/escritura)": [
    "https://www.googleapis.com/auth/devstorage.read_write",
    "https://www.googleapis.com/auth/devstorage.full_control",
  ],
  "Cloud SQL Admin": ["https://www.googleapis.com/auth/sqlservice.admin"],
};

export interface ComputeIdentity {
  available: boolean;
  email: string | null;
  projectId: string | null;
  scopes: string[];
  missingScopes: string[];
}

const NONE: ComputeIdentity = { available: false, email: null, projectId: null, scopes: [], missingScopes: [] };
let cache: { at: number; value: ComputeIdentity } | null = null;

async function get(path: string): Promise<string> {
  const res = await fetch(`${METADATA}/${path}`, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`metadata ${res.status}`);
  return (await res.text()).trim();
}

export async function detectComputeIdentity(): Promise<ComputeIdentity> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: ComputeIdentity;
  try {
    const [email, projectId, scopesRaw] = await Promise.all([
      get("instance/service-accounts/default/email"),
      get("project/project-id"),
      get("instance/service-accounts/default/scopes"),
    ]);
    const scopes = scopesRaw.split(/\s+/).filter(Boolean);
    const missingScopes = scopes.includes(CLOUD_PLATFORM)
      ? []
      : Object.entries(REQUIRED)
          .filter(([, any]) => !any.some((s) => scopes.includes(s)))
          .map(([label]) => label);
    value = { available: true, email, projectId, scopes, missingScopes };
  } catch {
    // Fuera de GCE (o VM sin cuenta de servicio): no hay identidad que ofrecer.
    value = NONE;
  }
  cache = { at: Date.now(), value };
  return value;
}
