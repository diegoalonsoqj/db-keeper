import type { TFunction } from "i18next";

/**
 * Etiqueta de una opción de selector. Los inactivos solo aparecen si ya estaban
 * asignados; se marcan para que se vea que conviene cambiarlos.
 */
export function optionLabel(t: TFunction, label: string, isActive: boolean): string {
  return isActive ? label : `${label} (${t("common.inactive").toLowerCase()})`;
}
