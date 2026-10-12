/**
 * Nombres de base de datos de un evento de backup. Llegan a pg_dump (`-d`) y a
 * mysqldump (argumento posicional), así que se rechaza lo que esas herramientas
 * interpretarían como otra cosa:
 * - con `=` o prefijo `postgres://`/`postgresql://`: pg_dump lo toma como cadena de
 *   conexión (`host=otro-servidor dbname=x`) y enviaría la contraseña a ese host;
 * - empezando por `-`: mysqldump/pg_dump lo tomarían como opción (`--host=...`);
 * - caracteres de control.
 * Devuelve el motivo del rechazo o null si es válido.
 */
export function databaseNameError(name: string): string | null {
  if (!name.trim()) return "El nombre de la base de datos está vacío";
  if (name.startsWith("-")) return "El nombre de la base de datos no puede empezar con «-»";
  if (name.includes("=")) return "El nombre de la base de datos no puede contener «=»";
  if (/^postgres(ql)?:\/\//i.test(name)) return "El nombre de la base de datos no puede ser una URL de conexión";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return "El nombre de la base de datos tiene caracteres de control";
  return null;
}
