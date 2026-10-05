import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { Check, ChevronRight, Copy, MessageCircle, UserRoundPlus, X } from "lucide-react";
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
  const [finalizing, setFinalizing] = useState<PendingInvite | null>(null);
  if (list.length === 0) return null;

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Aguardando cadastro ({list.length})
      </p>
      <p className="text-xs text-muted-foreground">
        Pré-cadastrados pelo link da escala. Toque no corretor para finalizar o cadastro você mesmo,
        ou envie o convite para ele se cadastrar. Os turnos já escalados passam para a conta dele.
      </p>
      {list.map((p) => (
        <div
          key={p.id}
          className="bg-white rounded-2xl border border-dashed border-border p-3 flex items-center gap-3"
        >
          <button
            type="button"
            onClick={() => setFinalizing(p)}
            className="flex flex-1 min-w-0 items-center gap-3 text-left"
            title="Finalizar cadastro"
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
              <p className="text-[11px] font-semibold text-[var(--gold-dark)] mt-0.5 inline-flex items-center gap-0.5">
                Finalizar cadastro <ChevronRight size={12} />
              </p>
            </div>
          </button>
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
      {finalizing && <FinalizeSheet pending={finalizing} onClose={() => setFinalizing(null)} />}
    </section>
  );
}

const tempPasswordOf = () => "PeG@" + Math.floor(100000 + Math.random() * 900000);

/**
 * Admin ou gerente finaliza o cadastro do corretor pré-cadastrado: cria a
 * conta com senha temporária. O banco liga a conta ao pré-cadastro (mesmo
 * e-mail), coloca na equipe e passa os turnos escalados.
 */
function FinalizeSheet({ pending, onClose }: { pending: PendingInvite; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(pending.full_name);
  const [local, setLocal] = useState(pending.email ? pending.email.split("@")[0] : "");
  const [phone, setPhone] = useState("");
  const [tempPassword] = useState(tempPasswordOf);
  const [done, setDone] = useState<{ email: string } | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Informe o nome.");
      // confirma (ou ajusta) o e-mail do pré-cadastro: o convite só vale para ele
      const { data: email, error: eErr } = await (supabase as any).rpc("crm_pending_set_email", {
        p_id: pending.id,
        p_email: local.trim(),
      });
      if (eErr) throw eErr;
      const temp = createClient((supabase as any).supabaseUrl, (supabase as any).supabaseKey, {
        auth: { persistSession: false },
      });
      const { data, error } = await temp.auth.signUp({
        email: email as string,
        password: tempPassword,
        options: {
          data: {
            full_name: name.trim(),
            phone: phone.trim() || null,
            force_password_change: true,
            pending_token: pending.invite_token,
          },
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Não foi possível criar o usuário.");
      return email as string;
    },
    onSuccess: (email) => {
      qc.invalidateQueries({ queryKey: ["pending-invites"] });
      qc.invalidateQueries({ queryKey: ["pending-shifts"] });
      qc.invalidateQueries({ queryKey: ["brokers-active"] });
      qc.invalidateQueries({ queryKey: ["team-managers"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
      setDone({ email });
    },
    onError: (e: any) => toast.error(e.message || "Erro ao finalizar o cadastro"),
  });

  const inputCls = "w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border";

  if (done) {
    const msg = `Olá ${name.trim()}! Seu cadastro no sistema da Paes & Gregori está pronto e você já está na escala da equipe.\n\nAcesso: ${window.location.origin}\nE-mail: ${done.email}\nSenha inicial: ${tempPassword}\n\nAcesse e altere sua senha no primeiro login.`;
    const digits = phone.replace(/\D/g, "");
    return (
      <div
        className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        <div
          className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center text-center gap-2">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <Check size={28} className="text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--navy)]">Cadastro finalizado!</h3>
            <p className="text-sm text-muted-foreground">
              {name.trim()} já está na equipe, com os turnos escalados.
            </p>
          </div>
          <textarea
            readOnly
            value={msg}
            rows={7}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-xl border border-border bg-[var(--surface)] p-3 text-sm text-[var(--navy)] resize-none"
          />
          <a
            href={`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`}
            target="_blank"
            rel="noreferrer"
            className="w-full h-12 rounded-xl bg-green-500 text-white font-semibold flex items-center justify-center gap-2"
          >
            <MessageCircle size={18} /> Enviar acesso no WhatsApp
          </a>
          <button
            onClick={() => {
              navigator.clipboard.writeText(msg);
              toast.success("Mensagem copiada!");
            }}
            className="w-full h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold flex items-center justify-center gap-2"
          >
            <Copy size={18} /> Copiar mensagem
          </button>
          <button
            onClick={onClose}
            className="w-full h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--navy)]">Finalizar cadastro</h3>
          <button onClick={onClose} className="text-muted-foreground" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Cria a conta do corretor com senha temporária. Ele entra na equipe com os {pending.shifts}{" "}
          turno{pending.shifts === 1 ? "" : "s"} já escalado{pending.shifts === 1 ? "" : "s"}.
        </p>
        <input
          className={inputCls}
          placeholder="Nome completo"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="h-12 flex items-center rounded-xl bg-[var(--surface)] border border-border overflow-hidden">
          <input
            value={local}
            onChange={(e) =>
              setLocal(e.target.value.replace(/@.*$/, "").replace(/\s/g, "").toLowerCase())
            }
            placeholder="e-mail"
            autoCapitalize="none"
            autoCorrect="off"
            className="flex-1 min-w-0 h-full px-4 bg-transparent outline-none"
            aria-label="E-mail (antes de @pgvendas.com.br)"
          />
          <span className="pr-4 text-sm text-muted-foreground whitespace-nowrap">
            @pgvendas.com.br
          </span>
        </div>
        <input
          className={inputCls}
          placeholder="Telefone (ex: +55 11 99999-9999)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <div>
          <p className="text-xs text-muted-foreground font-medium mb-2 text-center">
            Senha temporária
          </p>
          <input
            type="text"
            readOnly
            value={tempPassword}
            className="w-full h-12 px-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-mono font-bold text-lg text-center tracking-wider select-all"
          />
          <p className="text-[11px] text-muted-foreground mt-2 text-center">
            O corretor define uma nova senha no primeiro acesso.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={() => m.mutate()}
            disabled={!name.trim() || !local.trim() || m.isPending}
            className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
          >
            {m.isPending ? "Finalizando…" : "Finalizar cadastro"}
          </button>
        </div>
      </div>
    </div>
  );
}
