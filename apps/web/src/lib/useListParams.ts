import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type SortDir } from "@dbkeeper/shared";

interface Options<F extends string, S extends string> {
  /** Filtros propios del listado (claves del query string). */
  filters: readonly F[];
  /** Orden por defecto (el que aplica la API sin `sort`). */
  defaultSort: { key: S; dir: SortDir };
  /** Filtros de fecha (`YYYY-MM-DD`): se envían como inicio del día en la zona del navegador. */
  dateFilters?: readonly F[];
}

/** Inicio del día local de un `YYYY-MM-DD`, en ISO (para que la API compare instantes). */
function localDayStart(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString() : null;
}

/**
 * Estado de un listado (búsqueda, filtros, orden y página) guardado en la URL: se
 * conserva al recargar y se puede compartir. Cambiar búsqueda, filtro u orden vuelve
 * a la primera página. `apiQuery` es el query string listo para la API.
 */
export function useListParams<F extends string, S extends string>(opts: Options<F, S>) {
  const [sp, setSp] = useSearchParams();

  const rawLimit = Number(sp.get("limit"));
  const limit = (PAGE_SIZES as readonly number[]).includes(rawLimit) ? rawLimit : DEFAULT_PAGE_SIZE;
  const offset = Math.max(0, Math.floor(Number(sp.get("offset")) || 0));
  const q = sp.get("q") ?? "";
  const sortParam = (sp.get("sort") ?? "") as S | "";
  const dirParam = sp.get("dir");
  const dir: SortDir | "" = dirParam === "asc" || dirParam === "desc" ? dirParam : "";
  const filterKey = opts.filters.map((k) => `${k}=${sp.get(k) ?? ""}`).join("&");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => Object.fromEntries(opts.filters.map((k) => [k, sp.get(k) ?? ""])) as Record<F, string>, [filterKey]);

  const sort: S = sortParam || opts.defaultSort.key;
  const sortDir: SortDir = dir || (sortParam ? "asc" : opts.defaultSort.dir);

  /** Aplica cambios al query string; vacío = quitar. Por defecto vuelve a la página 1. */
  const update = useCallback(
    (patch: Record<string, string | number | null | undefined>, keepOffset = false) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === "" || v == null) next.delete(k);
            else next.set(k, String(v));
          }
          if (!keepOffset) next.delete("offset");
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  const setPage = useCallback(
    (p: { limit: number; offset: number }) =>
      update({ limit: p.limit === DEFAULT_PAGE_SIZE ? null : p.limit, offset: p.offset || null }, true),
    [update],
  );

  /** Clic en un encabezado: misma columna invierte el sentido; otra columna empieza en `firstDir`. */
  const toggleSort = useCallback(
    (key: S, firstDir: SortDir = "asc") => {
      const nextDir: SortDir = key === sort ? (sortDir === "asc" ? "desc" : "asc") : firstDir;
      const isDefault = key === opts.defaultSort.key && nextDir === opts.defaultSort.dir;
      update(isDefault ? { sort: null, dir: null } : { sort: key, dir: nextDir });
    },
    [sort, sortDir, opts.defaultSort.key, opts.defaultSort.dir, update],
  );

  /** Quita búsqueda y filtros (conserva el orden y el tamaño de página). */
  const clear = useCallback(
    () => update(Object.fromEntries(["q", ...opts.filters].map((k) => [k, null]))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update, opts.filters.join(",")],
  );

  const apiQuery = useMemo(() => {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q) qs.set("q", q);
    if (sortParam) qs.set("sort", sortParam);
    if (dir) qs.set("dir", dir);
    for (const k of opts.filters) {
      const v = filters[k];
      if (!v) continue;
      if (opts.dateFilters?.includes(k)) {
        const iso = localDayStart(v);
        if (iso) qs.set(k, iso);
      } else qs.set(k, v);
    }
    return qs.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, offset, q, sortParam, dir, filters]);

  const hasFilters = Boolean(q) || opts.filters.some((k) => Boolean(filters[k]));

  return { limit, offset, q, filters, sort, sortDir, hasFilters, apiQuery, update, setPage, toggleSort, clear };
}

export type ListParams<F extends string, S extends string> = ReturnType<typeof useListParams<F, S>>;
