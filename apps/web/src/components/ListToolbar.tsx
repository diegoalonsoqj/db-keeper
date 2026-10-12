import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

const SEARCH_DEBOUNCE_MS = 300;

interface DebouncedInputProps {
  /** Valor aplicado (de la URL). */
  value: string;
  /** Se llama al dejar de escribir o con Enter, con el texto sin espacios extremos. */
  onCommit: (value: string) => void;
  type?: "text" | "search";
  placeholder?: string;
}

/** Input de texto que aplica su valor al dejar de escribir (evita una consulta por tecla). */
export function DebouncedInput({ value, onCommit, type = "text", placeholder }: DebouncedInputProps) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // La URL manda: si cambia desde fuera (Limpiar, atrás/adelante), se refleja en el input.
  useEffect(() => setText(value), [value]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const commitNow = (v: string): void => {
    if (timer.current) clearTimeout(timer.current);
    if (v.trim() !== value) onCommit(v.trim());
  };

  return (
    <input
      type={type}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commitNow(v), SEARCH_DEBOUNCE_MS);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitNow(text);
      }}
    />
  );
}

interface Props {
  /** Texto de búsqueda aplicado (de la URL); sin `onSearch` no se muestra el buscador. */
  search?: string;
  onSearch?: (q: string) => void;
  searchPlaceholder?: string;
  /** Muestra "Limpiar" cuando hay búsqueda o filtros activos. */
  hasFilters: boolean;
  onClear: () => void;
  /** Controles de filtro propios del listado (`<label>` con su select/input). */
  children?: ReactNode;
}

/**
 * Barra común de los listados: buscador (se aplica al dejar de escribir), filtros
 * y "Limpiar". El filtrado lo hace la API (los listados están paginados).
 */
export function ListToolbar({ search = "", onSearch, searchPlaceholder, hasFilters, onClear, children }: Props) {
  const { t } = useTranslation();
  return (
    <div className="filters list-toolbar" role="search">
      {onSearch && (
        <label className="list-search">
          {t("list.search")}
          <DebouncedInput type="search" value={search} onCommit={onSearch} placeholder={searchPlaceholder} />
        </label>
      )}
      {children}
      {hasFilters && (
        <button type="button" className="secondary" onClick={onClear}>
          {t("list.clear")}
        </button>
      )}
    </div>
  );
}
