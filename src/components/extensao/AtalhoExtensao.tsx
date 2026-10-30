import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, KeyRound, PanelLeft, Puzzle } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useExtensaoLiberada, useExtensaoNoMenu } from "./comum";

/** Atalhos da extensão do WhatsApp em Minha Conta (só para quem está liberado). */
export function AtalhoExtensao() {
  const { user, profile, isSuperAdmin, refreshProfile } = useAuth();
  const liberada = useExtensaoLiberada();
  const noMenu = useExtensaoNoMenu();

  // ADM: mostra ou esconde a extensão no menu (enabled_features.extensao_menu)
  const alternar = useMutation({
    mutationFn: async (ligar: boolean) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          enabled_features: { ...(profile?.enabled_features ?? {}), extensao_menu: ligar },
        })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: async (_, ligar) => {
      await refreshProfile();
      toast.success(ligar ? "Extensão de volta no menu" : "Extensão fora do menu");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!liberada) return null;
  const item =
    "flex items-center gap-3 py-3.5 text-[var(--navy)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] rounded-lg";
  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <h2 className="text-base font-semibold text-[var(--navy)] mb-1">Extensão do WhatsApp</h2>
      <div className="divide-y divide-border">
        {isSuperAdmin && (
          <label className={`${item} cursor-pointer`}>
            <PanelLeft size={18} aria-hidden />
            <span className="flex-1">
              <span className="block text-sm font-medium">Mostrar no menu</span>
              <span className="block text-xs text-muted-foreground">
                Desligada, a extensão sai da barra lateral; os atalhos abaixo continuam.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={noMenu}
              disabled={alternar.isPending}
              onChange={(e) => alternar.mutate(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-6 w-11 shrink-0 rounded-full bg-gray-300 transition-colors peer-checked:bg-[var(--navy)] peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--gold)] after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
            />
          </label>
        )}
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
