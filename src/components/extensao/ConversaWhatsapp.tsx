import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Clock, ExternalLink, Mic, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lerBlocos, type MensagemCompacta } from "@/lib/extensao/formato";
import { linkHypnobox } from "@/lib/extensao/links";
import { useExtensaoLiberada } from "./comum";

// Conversa do WhatsApp do cliente, gravada pela extensão (só o trecho recente,
// que serve de contexto). Lida e descomprimida aqui no navegador, no celular
// também. O gerente vê só o tempo parado: o texto, o banco não entrega a ele.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as SupabaseClient<any>;

type Vinculo = {
  id: string;
  broker_id: string;
  nome_contato: string | null;
  id_cliente_hypnobox: string | null;
  n_msgs: number;
  ultima_cliente_em: string | null;
  ultima_corretor_em: string | null;
  ultima_lado: ">" | "<" | null;
  ultima_cliente_so_ok: boolean;
  atualizado_em: string;
};

const ha = (iso: string | null) => {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
};

const hora = (ts: number) =>
  new Date(ts * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const MARCA: Record<string, string> = { i: "Imagem", v: "Vídeo", d: "Documento" };

export function ConversaWhatsapp({ leadId, clientCode }: { leadId: string; clientCode: string | null }) {
  const liberada = useExtensaoLiberada();
  const vinculoQ = useQuery({
    queryKey: ["wa-vinculo-lead", leadId, clientCode],
    enabled: liberada,
    queryFn: async (): Promise<Vinculo | null> => {
      const filtro = clientCode
        ? `lead_id.eq.${leadId},id_cliente_hypnobox.eq.${clientCode.replace(/[^0-9A-Za-z_-]/g, "")}`
        : `lead_id.eq.${leadId}`;
      const { data, error } = await db
        .from("wa_vinculos")
        .select(
          "id, broker_id, nome_contato, id_cliente_hypnobox, n_msgs, ultima_cliente_em, ultima_corretor_em, ultima_lado, ultima_cliente_so_ok, atualizado_em",
        )
        .or(filtro)
        .eq("nao_cliente", false)
        .order("atualizado_em", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as Vinculo) ?? null;
    },
  });
  const v = vinculoQ.data;
  const msgsQ = useQuery({
    queryKey: ["wa-conversa", v?.id, v?.atualizado_em],
    enabled: !!v,
    queryFn: async (): Promise<MensagemCompacta[]> => {
      const { data, error } = await db.from("wa_conversa_blocos").select("dados").eq("vinculo_id", v!.id).order("mes");
      if (error) throw error;
      return lerBlocos((data ?? []) as { dados: string }[]);
    },
  });

  if (!liberada || !v) return null;
  const msgs = msgsQ.data ?? [];
  const esperandoCorretor = v.ultima_lado === "<" && !v.ultima_cliente_so_ok;

  return (
    <div className="bg-white rounded-2xl border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--navy)]">WhatsApp</h3>
        {v.id_cliente_hypnobox && (
          <a
            href={linkHypnobox(v.id_cliente_hypnobox)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--gold-dark)] hover:underline"
          >
            Abrir no Hypnobox <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>
      <p
        className={`mb-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ${
          esperandoCorretor ? "bg-amber-50 text-amber-900" : "bg-[var(--surface)] text-[var(--navy)]"
        }`}
      >
        <Clock size={14} aria-hidden />
        {esperandoCorretor
          ? `Cliente esperando resposta há ${ha(v.ultima_cliente_em)}`
          : v.ultima_lado === ">"
            ? `Aguardando o cliente há ${ha(v.ultima_corretor_em)}`
            : v.ultima_cliente_so_ok
              ? `Cliente só confirmou há ${ha(v.ultima_cliente_em)}: hora do próximo passo`
              : "Sem mensagens guardadas ainda"}
      </p>
      {msgsQ.isError ? null : msgs.length > 0 ? (
        <ol className="max-h-96 space-y-1.5 overflow-y-auto pr-1" aria-label="Mensagens recentes">
          {msgs.map((m, i) => (
            <li key={`${m.id}-${m.ts}-${i}`} className={`flex ${m.lado === ">" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${
                  m.lado === ">" ? "bg-[#d9fdd3] text-[var(--navy)]" : "bg-[var(--surface)] text-[var(--navy)]"
                }`}
              >
                {m.tipo === "a" ? (
                  <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Mic size={12} aria-hidden /> Áudio{m.seg ? ` · ${m.seg}s` : ""}
                    {!m.texto && " (sem transcrição)"}
                  </span>
                ) : m.tipo ? (
                  <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Paperclip size={12} aria-hidden /> {MARCA[m.tipo]}
                  </span>
                ) : null}
                {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
                <p className="mt-0.5 text-right text-[10px] text-muted-foreground">{hora(m.ts)}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        !msgsQ.isLoading && (
          <p className="text-xs text-muted-foreground">
            Só o corretor do cliente e a supervisão leem a conversa.
          </p>
        )
      )}
    </div>
  );
}
