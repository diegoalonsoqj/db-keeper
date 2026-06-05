import type { ApiResponse } from "@dbkeeper/shared";

/** Error con el código y mensaje devueltos por la API. */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError("PARSE_ERROR", `Respuesta no válida (HTTP ${res.status})`, res.status);
  }

  if (!payload.ok) {
    throw new ApiClientError(payload.error.code, payload.error.message, res.status, payload.error.details);
  }
  return payload.data;
}

/** Descarga un archivo binario de la API y lo guarda en el navegador. */
async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as ApiResponse<unknown>;
      if (!j.ok) message = j.error.message;
    } catch {
      /* respuesta no-JSON */
    }
    throw new ApiClientError("DOWNLOAD_ERROR", message, res.status);
  }
  const cd = res.headers.get("Content-Disposition");
  const match = cd ? /filename="?([^"]+)"?/.exec(cd) : null;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  download,
};
