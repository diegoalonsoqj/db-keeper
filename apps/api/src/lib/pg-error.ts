/** Helpers para clasificar errores de PostgreSQL por su SQLSTATE. */

function pgCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** 23503: foreign_key_violation. */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgCode(err) === "23503";
}

/** 23505: unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === "23505";
}
