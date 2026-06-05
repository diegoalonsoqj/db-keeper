import { useEffect, useState } from "react";
import type { EnvironmentDto, Paginated } from "@dbkeeper/shared";
import { api } from "./api";

/** Carga el catálogo de ambientes (para resolver código → nombre en las tablas). */
export function useEnvironments(): EnvironmentDto[] {
  const [environments, setEnvironments] = useState<EnvironmentDto[]>([]);
  useEffect(() => {
    api
      .get<Paginated<EnvironmentDto>>("/environments?limit=200")
      .then((p) => setEnvironments(p.items))
      .catch(() => {});
  }, []);
  return environments;
}

/**
 * Etiqueta legible de un ambiente a partir de su código: «Nombre (CÓDIGO)». Si el
 * código no está en el catálogo, devuelve el código tal cual; si no hay código, null.
 */
export function environmentLabel(
  environments: EnvironmentDto[],
  code: string | null,
): string | null {
  if (!code) return null;
  const env = environments.find((e) => e.code.toLowerCase() === code.toLowerCase());
  return env ? `${env.name} (${env.code})` : code;
}
