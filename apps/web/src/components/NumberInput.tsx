import { useState } from "react";

interface Props {
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * Campo numérico entero que deja borrar y reescribir (p. ej. pasar de 1 a 2). Un
 * input controlado que ajusta al mínimo en cada tecla vuelve a poner el valor al
 * quedar vacío; aquí el texto se edita libre y se ajusta a [min, max] al salir.
 */
export function NumberInput({ value, min, max, disabled, onChange }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, Math.trunc(n)));

  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Valor válido dentro del rango: se aplica ya (el botón Guardar lo envía).
        const n = Number(raw);
        if (raw !== "" && Number.isFinite(n) && n === clamp(n)) onChange(n);
      }}
      onBlur={() => {
        if (draft === null) return;
        const n = Number(draft);
        if (draft !== "" && Number.isFinite(n)) onChange(clamp(n));
        setDraft(null); // vacío o inválido: vuelve al último valor válido
      }}
    />
  );
}
