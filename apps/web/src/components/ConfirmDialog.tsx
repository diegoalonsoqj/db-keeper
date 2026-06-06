import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );

  const close = (value: boolean) => {
    setOpts(null);
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <Modal
          title={opts.title ?? t("common.confirmTitle")}
          size="sm"
          onClose={() => close(false)}
          footer={
            <>
              <button className="secondary" onClick={() => close(false)}>
                {t("common.cancel")}
              </button>
              <button className={opts.danger ? "danger" : ""} onClick={() => close(true)}>
                {opts.confirmLabel ?? t("common.confirmOk")}
              </button>
            </>
          }
        >
          <p>{opts.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return ctx;
}
