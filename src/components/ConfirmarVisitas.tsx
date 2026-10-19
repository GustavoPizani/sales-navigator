import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarCheck, Check, Loader2, X } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Pendente = {
  id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  client_name: string | null;
};

const agoraLocal = () => {
  const d = new Date();
  return { dia: format(d, "yyyy-MM-dd"), hora: format(d, "HH:mm:ss") };
};

/**
 * Depois do horário de uma visita (agendada pelo lead), pergunta ao dono do
 * agendamento se ela aconteceu. A resposta move o lead ("Visita realizada" ou
 * de volta para "Em contato") e fica no histórico. Aparece em qualquer tela até
 * ser respondida; o push "A visita terminou" leva para cá também.
 */
export function ConfirmarVisitas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [agora, setAgora] = useState(agoraLocal);
  // reavalia a cada minuto: a visita entra na lista assim que termina
  useEffect(() => {
    const t = window.setInterval(() => setAgora(agoraLocal()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const q = useQuery({
    queryKey: ["visitas-a-confirmar", user?.id, agora.dia, agora.hora.slice(0, 5)],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id,title,date,start_time,end_time,client_name")
        .eq("owner_id", user!.id)
        .eq("type", "visit")
        .not("lead_id", "is", null)
        .is("visit_status", null)
        .lte("date", agora.dia)
        .gte("date", format(new Date(Date.now() - 30 * 864e5), "yyyy-MM-dd"))
        .order("date")
        .order("end_time");
      if (error) throw error;
      // só as que já terminaram
      return ((data ?? []) as Pendente[]).filter(
        (a) => a.date < agora.dia || a.end_time <= agora.hora,
      );
    },
  });

  const marcar = useMutation({
    mutationFn: async ({ id, aconteceu }: { id: string; aconteceu: boolean }) => {
      const { error } = await supabase.rpc(
        aconteceu ? "crm_mark_visit_done" : "crm_mark_visit_not_done",
        {
          p_appointment_id: id,
        },
      );
      if (error) throw error;
      return aconteceu;
    },
    onSuccess: (aconteceu) => {
      qc.invalidateQueries({ queryKey: ["visitas-a-confirmar"] });
      qc.invalidateQueries({ queryKey: ["my-appts"] });
      qc.invalidateQueries({ queryKey: ["team-appts"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard-visitas"] });
      qc.invalidateQueries({ queryKey: ["dashboard-leads"] });
      toast.success(
        aconteceu ? "Visita registrada como realizada" : "Visita registrada como não realizada",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível registrar."),
  });

  const lista = q.data ?? [];
  if (!lista.length) return null;
  const v = lista[0];
  const quem = v.client_name || v.title.replace(/^Visita\s*[–-]\s*/, "");
  const quando = `${format(new Date(`${v.date}T00:00:00`), "EEEE, d/MM", { locale: ptBR })} às ${v.start_time.slice(0, 5)}`;
  const ocupado = marcar.isPending && marcar.variables?.id === v.id;

  return (
    <section
      aria-live="polite"
      aria-label="Visita para confirmar"
      className="fixed inset-x-3 z-40 rounded-2xl border border-amber-200 bg-amber-50 p-3 shadow-xl bottom-[calc(env(safe-area-inset-bottom)+6rem)] lg:bottom-6 lg:left-auto lg:right-6 lg:w-[380px] lg:p-4"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"
          aria-hidden
        >
          <CalendarCheck size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900">
            A visita aconteceu?
            {lista.length > 1 && (
              <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                {lista.length} para confirmar
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-amber-900/90 first-letter:uppercase">
            <b>{quem}</b> · {quando}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={marcar.isPending}
          onClick={() => marcar.mutate({ id: v.id, aconteceu: true })}
          className="h-11 rounded-xl bg-green-600 text-white text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {ocupado && marcar.variables?.aconteceu ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}
          Aconteceu
        </button>
        <button
          type="button"
          disabled={marcar.isPending}
          onClick={() => marcar.mutate({ id: v.id, aconteceu: false })}
          className="h-11 rounded-xl border border-red-200 bg-white text-red-700 text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {ocupado && !marcar.variables?.aconteceu ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <X size={16} />
          )}
          Não aconteceu
        </button>
      </div>
    </section>
  );
}
