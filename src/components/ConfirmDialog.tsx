import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

export type ConfirmOptions = {
  title: string;
  /** o que acontece ao confirmar */
  description?: string;
  /** texto do botão de ação (padrão: "Confirmar") */
  confirmLabel?: string;
  cancelLabel?: string;
  /** ação que apaga ou não tem volta: botão vermelho */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let open: ((p: Pending) => void) | null = null;

/**
 * Confirmação padrão do sistema, no lugar do window.confirm do navegador:
 *   if (!(await confirmDialog({ title: "Excluir?", danger: true }))) return;
 * Precisa do <ConfirmHost /> montado na raiz do app.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // sem a janela montada (não deveria acontecer), cai na confirmação do navegador
    if (!open) return resolve(window.confirm([options.title, options.description].filter(Boolean).join("\n\n")));
    open({ ...options, resolve });
  });
}

/** Janela única de confirmação; fica na raiz e atende a qualquer tela. */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    open = (p) =>
      setPending((current) => {
        // uma confirmação por vez: a anterior é tratada como cancelada
        current?.resolve(false);
        return p;
      });
    return () => {
      open = null;
    };
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    // foco no "Cancelar": Enter por engano não dispara a ação
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!pending) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center"
      onClick={() => close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={pending.description ? "confirm-desc" : undefined}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {pending.danger && (
            <div className="h-10 w-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} />
            </div>
          )}
          <div className="min-w-0">
            <h3 id="confirm-title" className="text-lg font-semibold text-[var(--navy)]">
              {pending.title}
            </h3>
            {pending.description && (
              <p id="confirm-desc" className="text-sm text-muted-foreground mt-1">
                {pending.description}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => close(false)}
            className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
          >
            {pending.cancelLabel ?? "Cancelar"}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={`flex-1 h-12 rounded-xl font-semibold text-white ${pending.danger ? "bg-red-600" : "bg-[var(--navy)]"}`}
          >
            {pending.confirmLabel ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
