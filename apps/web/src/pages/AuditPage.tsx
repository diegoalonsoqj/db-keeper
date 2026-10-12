import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AuditEntryDto, type AuditSort, type Paginated } from "@dbkeeper/shared";
import { api, ApiClientError } from "../lib/api";
import { useToast } from "../components/Toast";
import { Pagination } from "../components/Pagination";
import { DebouncedInput, ListToolbar } from "../components/ListToolbar";
import { SortTh } from "../components/SortTh";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { useListParams } from "../lib/useListParams";

const errMsg = (e: unknown) => (e instanceof ApiClientError ? e.message : String(e));

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<Paginated<AuditEntryDto>>({ items: [], total: 0 });
  const list = useListParams<"from" | "to" | "action" | "entityType" | "username", AuditSort>({
    filters: ["from", "to", "action", "entityType", "username"],
    dateFilters: ["from", "to"],
    defaultSort: { key: "created", dir: "desc" },
  });

  useEffect(() => {
    api
      .get<Paginated<AuditEntryDto>>(`/audit?${list.apiQuery}`)
      .then(setData)
      .catch((e) => toast.error(errMsg(e)));
  }, [list.apiQuery, toast]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const sth = { sort: list.sort, dir: list.sortDir, onSort: list.toggleSort };

  return (
    <section>
      <ListToolbar hasFilters={list.hasFilters} onClear={list.clear}>
        <DateRangeFilter
          label={t("dateRange.label")}
          from={list.filters.from}
          to={list.filters.to}
          onChange={(r) => list.update(r)}
        />
        <label>
          {t("audit.action")}
          <DebouncedInput value={list.filters.action} onCommit={(action) => list.update({ action })} placeholder="servers.create" />
        </label>
        <label>
          {t("audit.entity")}
          <DebouncedInput
            value={list.filters.entityType}
            onCommit={(entityType) => list.update({ entityType })}
            placeholder="server"
          />
        </label>
        <label>
          {t("audit.user")}
          <DebouncedInput value={list.filters.username} onCommit={(username) => list.update({ username })} />
        </label>
      </ListToolbar>

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <SortTh sortKey="created" firstDir="desc" {...sth}>
                {t("audit.when")}
              </SortTh>
              <SortTh sortKey="username" {...sth}>
                {t("audit.user")}
              </SortTh>
              <SortTh sortKey="action" {...sth}>
                {t("audit.action")}
              </SortTh>
              <SortTh sortKey="entity" {...sth}>
                {t("audit.entity")}
              </SortTh>
              <SortTh sortKey="ip" {...sth}>
                {t("audit.ip")}
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {list.hasFilters ? t("list.noResults") : t("audit.empty")}
                </td>
              </tr>
            )}
            {data.items.map((e) => (
              <tr key={e.id}>
                <td>{fmt(e.createdAt)}</td>
                <td>{e.username ?? "—"}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>{e.entityType ? `${e.entityType}${e.entityId ? `:${e.entityId.slice(0, 8)}` : ""}` : "—"}</td>
                <td>{e.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} limit={list.limit} offset={list.offset} onChange={list.setPage} />
    </section>
  );
}
