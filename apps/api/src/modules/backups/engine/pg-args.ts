/**
 * Argumentos `<flag>="<nombre>"` de pg_dump para cada nombre. Entre comillas
 * dobles el patrón es literal (sin comodines * ? y respetando mayúsculas); las
 * comillas internas se duplican. Van como elementos del array de spawn (sin
 * shell), así que no hay inyección.
 */
export function quotedPatternArgs(flag: string, names: string[]): string[] {
  return names.map((n) => `${flag}="${n.replace(/"/g, '""')}"`);
}
