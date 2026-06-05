import { useEffect, useState } from "react";
import type { Paginated, StorageTargetDto } from "@dbkeeper/shared";
import { api } from "./api";

/** Carga el catálogo de destinos de almacenamiento (para resolver etiquetas en tablas). */
export function useStorageTargets(): StorageTargetDto[] {
  const [targets, setTargets] = useState<StorageTargetDto[]>([]);
  useEffect(() => {
    api
      .get<Paginated<StorageTargetDto>>("/storage?limit=100")
      .then((p) => setTargets(p.items))
      .catch(() => {});
  }, []);
  return targets;
}

/** Destino local marcado por defecto (o undefined). */
export function defaultLocalTarget(targets: StorageTargetDto[]): StorageTargetDto | undefined {
  return targets.find((s) => s.type === "local" && s.isDefault);
}
