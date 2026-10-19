/**
 * Reemplaza un secreto por `***` en un texto (mensajes de error, líneas de consola).
 * Cubre también su forma codificada para URL: así va la contraseña dentro de una URI
 * de conexión (p. ej. la de mongodump), y con `@ : / %` no coincide con la cruda.
 */
export function maskSecret(text: string, secret: string): string {
  if (!secret) return text;
  // De más larga a más corta: ninguna variante deja restos de otra.
  const variants = [...new Set([secret, encodeURIComponent(secret), encodeURI(secret)])].sort(
    (a, b) => b.length - a.length,
  );
  return variants.reduce((out, v) => out.split(v).join("***"), text);
}
