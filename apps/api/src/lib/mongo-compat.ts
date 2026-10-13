/**
 * Servidor MongoDB más viejo de lo que soporta el cliente. Cubre las redacciones del
 * driver Node (handshake y selección de servidor) y del driver Go que usa mongodump:
 * "... wire version 6, but this version of the [Node.js |Go ]driver requires at least 8".
 */
const WIRE_VERSION_RE = /wire version \d+, but this version of the ([\w.]+ )?driver requires at least/i;

export function isWireVersionTooLow(err: unknown): boolean {
  if (typeof err === "string") return WIRE_VERSION_RE.test(err);
  if (!(err instanceof Error)) return false;
  return WIRE_VERSION_RE.test(err.message) || (err.cause instanceof Error && WIRE_VERSION_RE.test(err.cause.message));
}
