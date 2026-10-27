import { useAuth } from "@/hooks/useAuth";

// Estilos e regra de acesso das telas da extensão do WhatsApp (mesmos botões da coleta guiada).

export const BOTAO =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45";
export const B_PRIMARIO = `${BOTAO} bg-[var(--navy)] text-white hover:bg-black`;
export const B_CONTORNO = `${BOTAO} border border-border bg-white text-[var(--navy)] hover:bg-[var(--surface)]`;
export const CAMPO =
  "h-11 w-full min-w-0 rounded-xl border border-border bg-[var(--surface)] px-3 text-sm text-[var(--navy)] focus:border-[var(--gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/40";

/**
 * Quem usa a extensão no MVP: o piloto (profiles.enabled_features.extensao), o
 * admin e a conta de teste. A API (/api/ext) aplica a mesma regra.
 */
export function useExtensaoLiberada(): boolean {
  const { profile, isTester } = useAuth();
  if (!profile) return false;
  return (
    isTester ||
    profile.role === "admin" ||
    profile.role === "director" ||
    profile.enabled_features?.extensao === true
  );
}
