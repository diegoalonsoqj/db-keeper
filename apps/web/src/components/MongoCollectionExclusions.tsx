import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  collectionRuleError,
  matchCollectionRule,
  parseCollectionRules,
  wildcardMatch,
  type MongoCollectionInfo,
} from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";

/** Tope de filas pintadas por BD: con miles de colecciones se pide afinar la búsqueda. */
const MAX_ROWS = 500;

interface Props {
  serverId: string;
  credentialId: string;
  /** BDs seleccionadas en el evento. */
  databases: string[];
  /** Reglas como texto (una por línea; también admite comas). */
  rulesText: string;
  onRulesTextChange: (text: string) => void;
  onError: (msg: string | null) => void;
}

/**
 * Exclusión de colecciones de MongoDB: reglas con `*` (p. ej. `*_old`) y, por BD,
 * un selector que lista las colecciones reales con buscador. Muestra en vivo qué
 * excluye cada regla; marcar una colección añade la regla exacta `<bd>.<colección>`.
 * Las reglas se aplican igual en el backup (misma función de @dbkeeper/shared).
 */
export function MongoCollectionExclusions(p: Props) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Record<string, MongoCollectionInfo[]>>({});
  const [loadingDb, setLoadingDb] = useState<string | null>(null);
  const [search, setSearch] = useState<Record<string, string>>({});

  const rules = useMemo(() => parseCollectionRules(p.rulesText), [p.rulesText]);
  const ruleErrors = rules.map((r) => collectionRuleError(r, p.databases)).filter((e): e is string => e !== null);

  async function load(db: string) {
    p.onError(null);
    setLoadingDb(db);
    try {
      const found = await api.post<MongoCollectionInfo[]>(`/servers/${p.serverId}/databases/collections`, {
        dbName: db,
        credentialId: p.credentialId || null,
      });
      setLoaded((prev) => ({ ...prev, [db]: found }));
    } catch (e) {
      p.onError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setLoadingDb(null);
    }
  }

  const setRules = (next: string[]) => p.onRulesTextChange(next.join("\n"));
  const exactRule = (db: string, coll: string) => `${db}.${coll}`;
  const isExact = (rule: string, db: string, coll: string) => rule.toLowerCase() === exactRule(db, coll).toLowerCase();

  /** Marca/desmarca a mano: añade o quita la regla exacta `<bd>.<colección>`. */
  function toggle(db: string, coll: string, rule: string | null) {
    if (rule === null) setRules([...rules, exactRule(db, coll)]);
    else if (isExact(rule, db, coll)) setRules(rules.filter((r) => r !== rule));
  }

  return (
    <fieldset>
      <legend>{t("backups.excludeCollections")}</legend>
      <label>
        <textarea
          rows={3}
          value={p.rulesText}
          onChange={(e) => p.onRulesTextChange(e.target.value)}
          placeholder={t("backups.excludeCollectionsPlaceholder")}
        />
        <small>{t("backups.excludeCollectionsHint")}</small>
      </label>
      {ruleErrors.map((e) => (
        <p key={e} className="error">
          {e}
        </p>
      ))}

      {[...p.databases].sort().map((db) => {
        const all = loaded[db];
        const q = (search[db] ?? "").trim();
        // El buscador acepta texto libre (contiene) o un patrón con `*`.
        const filtered = all?.filter((c) => (q.includes("*") ? wildcardMatch(q, c.name) : c.name.toLowerCase().includes(q.toLowerCase())));
        const matches = new Map((all ?? []).map((c) => [c.name, matchCollectionRule(rules, db, c.name, p.databases)]));
        const excludedCount = [...matches.values()].filter(Boolean).length;
        const filteredFree = (filtered ?? []).filter((c) => !matches.get(c.name));
        const filteredManual = (filtered ?? []).filter((c) => {
          const r = matches.get(c.name);
          return r && isExact(r, db, c.name);
        });
        return (
          <div key={db} className="schema-group">
            <div className="db-toolbar">
              <strong>{db}</strong>
              <button type="button" className="secondary" onClick={() => load(db)} disabled={loadingDb !== null}>
                {loadingDb === db ? t("backups.loadingCollections") : t("backups.loadCollections")}
              </button>
              {all && (
                <span className="muted">
                  {t("backups.collectionsExcludedOf", { excluded: excludedCount, total: all.length })}
                </span>
              )}
            </div>
            {all && all.length === 0 && <p className="muted">{t("backups.collectionsNone")}</p>}
            {all && all.length > 0 && excludedCount === all.length && (
              <p className="error">{t("backups.collectionsAllExcluded")}</p>
            )}
            {all && all.length > 0 && filtered && (
              <>
                <div className="db-toolbar">
                  <input
                    type="search"
                    value={search[db] ?? ""}
                    onChange={(e) => setSearch((prev) => ({ ...prev, [db]: e.target.value }))}
                    placeholder={t("backups.collectionsSearch")}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={filteredFree.length === 0}
                    onClick={() => setRules([...rules, ...filteredFree.map((c) => exactRule(db, c.name))])}
                  >
                    {t("backups.collectionsExcludeFiltered", { count: filteredFree.length })}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={filteredManual.length === 0}
                    onClick={() => {
                      const drop = new Set(filteredManual.map((c) => exactRule(db, c.name).toLowerCase()));
                      setRules(rules.filter((r) => !drop.has(r.toLowerCase())));
                    }}
                  >
                    {t("backups.collectionsIncludeFiltered", { count: filteredManual.length })}
                  </button>
                </div>
                <ul className="db-list">
                  {filtered.slice(0, MAX_ROWS).map((c) => {
                    const rule = matches.get(c.name) ?? null;
                    const byPattern = rule !== null && !isExact(rule, db, c.name);
                    return (
                      <li key={c.name}>
                        <label
                          className={`inline${rule ? " excluded-item" : ""}`}
                          title={rule ? t("backups.collectionsByRule", { rule }) : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={rule !== null}
                            disabled={byPattern}
                            onChange={() => toggle(db, c.name, rule)}
                          />
                          <span>{c.name}</span>
                          {c.type !== "collection" && <span className="muted">({c.type})</span>}
                          {byPattern && <span className="muted">← {rule}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {filtered.length > MAX_ROWS && (
                  <small className="muted">
                    {t("backups.collectionsTruncated", { shown: MAX_ROWS, total: filtered.length })}
                  </small>
                )}
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
