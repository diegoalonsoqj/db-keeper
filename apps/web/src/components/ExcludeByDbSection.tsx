import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiClientError } from "../lib/api";

/** Opción que se puede excluir del dump: nombre y etiqueta visible (p. ej. con versión). */
export interface ExcludableItem {
  name: string;
  label: string;
}

/**
 * Estado de una exclusión por BD (`options.<clave> = { bd: [nombres] }`): los
 * nombres excluidos, las opciones cargadas de cada BD con
 * `POST /servers/:id/databases/<path>` y qué BD está cargando.
 */
export function useDbExclusions<T>(opts: {
  initial: unknown;
  path: string;
  serverId: string;
  credentialId: string;
  toItem: (raw: T) => ExcludableItem;
  onError: (msg: string | null) => void;
}) {
  const [excluded, setExcluded] = useState<Record<string, string[]>>(
    (opts.initial as Record<string, string[]> | undefined) ?? {},
  );
  const [loaded, setLoaded] = useState<Record<string, ExcludableItem[]>>({});
  const [loadingDb, setLoadingDb] = useState<string | null>(null);

  async function load(db: string) {
    opts.onError(null);
    setLoadingDb(db);
    try {
      const found = await api.post<T[]>(`/servers/${opts.serverId}/databases/${opts.path}`, {
        dbName: db,
        credentialId: opts.credentialId || null,
      });
      setLoaded((prev) => ({ ...prev, [db]: found.map(opts.toItem) }));
    } catch (e) {
      opts.onError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setLoadingDb(null);
    }
  }

  function toggle(db: string, name: string) {
    setExcluded((prev) => {
      const current = new Set(prev[db] ?? []);
      if (current.has(name)) current.delete(name);
      else current.add(name);
      const next = { ...prev };
      if (current.size > 0) next[db] = [...current].sort();
      else delete next[db];
      return next;
    });
  }

  /** Exclusiones de las BDs seleccionadas, o undefined si no hay ninguna. */
  function forSave(selected: Set<string>): Record<string, string[]> | undefined {
    const out = Object.fromEntries(Object.entries(excluded).filter(([db, list]) => selected.has(db) && list.length > 0));
    return Object.keys(out).length > 0 ? out : undefined;
  }

  return { excluded, loaded, loadingDb, load, toggle, forSave };
}

interface Props {
  legend: string;
  /** Texto de ayuda sobre la lista (opcional). */
  hint?: string;
  /** Aviso debajo de la lista (opcional). */
  warning?: string;
  loadLabel: string;
  loadingLabel: string;
  /** BDs seleccionadas en el evento. */
  databases: string[];
  /** Opciones cargadas por BD (vacío hasta pulsar «Cargar»). */
  loaded: Record<string, ExcludableItem[]>;
  /** Nombres excluidos por BD. */
  excluded: Record<string, string[]>;
  /** BD cuya carga está en curso (deshabilita todos los botones). */
  loadingDb: string | null;
  onLoad: (db: string) => void;
  onToggle: (db: string, name: string) => void;
}

/**
 * Sección «excluir del dump» por BD (esquemas, extensiones, event triggers): botón
 * para cargar las opciones de cada BD y casillas para marcar las que NO van al
 * backup. Los ya excluidos se muestran aunque aún no se hayan cargado.
 */
export function ExcludeByDbSection(p: Props) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend>{p.legend}</legend>
      {p.hint && <p className="muted">{p.hint}</p>}
      {[...p.databases].sort().map((db) => {
        const excluded = p.excluded[db] ?? [];
        const labels = new Map((p.loaded[db] ?? []).map((i) => [i.name, i.label]));
        const names = [...new Set([...labels.keys(), ...excluded])].sort();
        return (
          <div key={db} className="schema-group">
            <div className="db-toolbar">
              <strong>{db}</strong>
              <button type="button" className="secondary" onClick={() => p.onLoad(db)} disabled={p.loadingDb !== null}>
                {p.loadingDb === db ? p.loadingLabel : p.loadLabel}
              </button>
              {excluded.length > 0 && (
                <span className="muted">{t("backups.excludedCount", { count: excluded.length })}</span>
              )}
            </div>
            {names.length > 0 && (
              <ul className="db-list">
                {names.map((n) => (
                  <li key={n}>
                    <label className="inline">
                      <input type="checkbox" checked={excluded.includes(n)} onChange={() => p.onToggle(db, n)} />
                      {labels.get(n) ?? n}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {p.warning && <p className="muted">{p.warning}</p>}
    </fieldset>
  );
}
