import { Link } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Puzzle } from "lucide-react";
import { useExtensaoLiberada } from "./comum";

/** Atalhos da extensão do WhatsApp em Minha Conta (só para quem está liberado). */
export function AtalhoExtensao() {
  if (!useExtensaoLiberada()) return null;
  const item =
    "flex items-center gap-3 py-3.5 text-[var(--navy)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] rounded-lg";
  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h2 className="text-base font-semibold text-[var(--navy)] mb-1">Extensão do WhatsApp</h2>
      <div className="divide-y divide-border">
        <Link to="/extensao" className={item}>
          <Puzzle size={18} aria-hidden />
          <span className="flex-1 text-sm font-medium">Instalar e primeiros passos</span>
          <ChevronRight size={16} className="text-muted-foreground" aria-hidden />
        </Link>
        <Link to="/settings/chave-ia" className={item}>
          <KeyRound size={18} aria-hidden />
          <span className="flex-1 text-sm font-medium">Minha chave de IA</span>
          <ChevronRight size={16} className="text-muted-foreground" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
