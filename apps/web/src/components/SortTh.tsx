import type { ReactNode } from "react";
import type { SortDir } from "@dbkeeper/shared";

interface Props<S extends string> {
  sortKey: S;
  /** Orden vigente del listado. */
  sort: S;
  dir: SortDir;
  onSort: (key: S, firstDir?: SortDir) => void;
  /** Sentido del primer clic (fechas y tamaños suelen empezar por el mayor). */
  firstDir?: SortDir;
  children: ReactNode;
}

/** Encabezado de columna ordenable (el orden lo aplica la API sobre todo el listado). */
export function SortTh<S extends string>({ sortKey, sort, dir, onSort, firstDir = "asc", children }: Props<S>) {
  const active = sort === sortKey;
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`sort-btn${active ? " active" : ""}`} onClick={() => onSort(sortKey, firstDir)}>
        {children}
        <span className="sort-icon" aria-hidden="true">
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
