/** Ubicación guardada por RequireAuth al mandar al login (`state.from`). */
interface FromLocation {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
}

/**
 * Destino tras iniciar sesión: la página que se pidió antes del login, solo si es
 * una ruta interna (empieza con una sola `/`; nunca `//host` ni `/\host`, que el
 * navegador trata como otro sitio) y no es el propio login. Si no, el Panel.
 */
export function postLoginTarget(state: unknown): string {
  const from = (state as { from?: FromLocation } | null)?.from;
  const pathname = typeof from?.pathname === "string" ? from.pathname : "";
  if (!/^\/(?![/\\])/.test(pathname) || pathname === "/login") return "/";
  const search = typeof from?.search === "string" && from.search.startsWith("?") ? from.search : "";
  const hash = typeof from?.hash === "string" && from.hash.startsWith("#") ? from.hash : "";
  return `${pathname}${search}${hash}`;
}
