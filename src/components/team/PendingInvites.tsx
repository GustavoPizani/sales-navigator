import { useQuery } from "@tanstack/react-query";
import { Copy, MessageCircle, UserRoundPlus } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";

type PendingInvite = {
  id: string;
  manager_id: string;
  full_name: string;
  email: string | null;
  invite_token: string;
  shifts: number;
};

export const inviteLink = (token: string) => `${window.location.origin}/cadastro?c=${token}`;

export const inviteMessage = (name: string, token: string) =>
  `Olá ${name}! Você já está na escala da equipe. Finalize seu cadastro no sistema da Paes & Gregori por este link:\n\n${inviteLink(token)}`;

/**
 * Corretores pré-cadastrados pelo link do gerente que ainda não criaram a
 * conta. Cada um tem um convite: ao se cadastrar por ele, entra na equipe e
 * fica com os turnos já escalados.
 */
export function PendingInvites({ teamLabel }: { teamLabel?: (managerId: string) => string }) {
  const q = useQuery({
    queryKey: ["pending-invites"],
    queryFn: async () => {
      // (RPC ainda não está nos tipos gerados do Supabase)
      const { data, error } = await (supabase as any).rpc("crm_pending_invites");
      if (error) throw error;
      return (data ?? []) as PendingInvite[];
    },
  });
  const list = q.data ?? [];
  if (list.length === 0) return null;

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Aguardando cadastro ({list.length})
      </p>
      <p className="text-xs text-muted-foreground">
        Pré-cadastrados pelo link da escala. Envie o convite para cada um finalizar o cadastro; os
        turnos já escalados passam para a conta dele.
      </p>
      {list.map((p) => (
        <div
          key={p.id}
          className="bg-white rounded-2xl border border-dashed border-border p-3 flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-full bg-[var(--surface)] flex items-center justify-center text-muted-foreground flex-shrink-0">
            <UserRoundPlus size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[var(--navy)] truncate">{p.full_name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {p.email ? `${p.email} · ` : "sem e-mail · "}
              {teamLabel ? `Equipe ${teamLabel(p.manager_id)} · ` : ""}
              {p.shifts} turno{p.shifts === 1 ? "" : "s"} na escala
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(inviteLink(p.invite_token));
              toast.success("Convite copiado!");
            }}
            className="w-9 h-9 rounded-xl bg-[var(--surface)] flex items-center justify-center text-muted-foreground"
            aria-label={`Copiar convite de ${p.full_name}`}
            title="Copiar convite"
          >
            <Copy size={15} />
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(p.full_name, p.invite_token))}`}
            target="_blank"
            rel="noreferrer"
            className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center text-green-600"
            aria-label={`Enviar convite de ${p.full_name} no WhatsApp`}
            title="Enviar convite no WhatsApp"
          >
            <MessageCircle size={15} />
          </a>
        </div>
      ))}
    </section>
  );
}
