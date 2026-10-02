import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, Link as LinkIcon, Loader2, MessageCircle, X } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { shortenUrl } from "@/lib/shorten.functions";
import { locationOfModality, usePdvLabels } from "@/hooks/useRoulette";
import { QUOTA_PERIODS } from "./TeamQuotaEditor";

/**
 * Links de escala de uma equipe: mostra as vagas definidas pelo admin (por PDV,
 * dia e turno — somente leitura) e o link para os corretores pegarem as vagas.
 */
export function ScheduleLinksButton({ managerId }: { managerId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 h-9 px-4 rounded-xl bg-white border border-border text-[var(--navy)] font-bold text-sm hover:bg-gray-50"
      >
        <LinkIcon size={16} strokeWidth={2.5} />
        <span className="hidden sm:inline">Links da escala</span>
      </button>
      {open && <ScheduleLinks managerId={managerId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ScheduleLinks({ managerId, onClose }: { managerId: string; onClose: () => void }) {
  const labels = usePdvLabels();
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }),
  );
  const weekStr = format(weekStart, "yyyy-MM-dd");
  const [sending, setSending] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["shift-links", managerId, weekStr],
    queryFn: async () => {
      const { data: configs, error } = await supabase
        .from("shift_configs")
        .select("id, modality, link_token")
        .eq("manager_id", managerId)
        .eq("week_start_date", weekStr);
      if (error) throw error;
      if (!configs?.length) return [];
      const { data: slots } = await supabase
        .from("shift_slots")
        .select("id, config_id, date, period, capacity")
        .in(
          "config_id",
          configs.map((c) => c.id),
        );
      const { data: shifts } = await supabase
        .from("shifts")
        .select("slot_id")
        .in(
          "slot_id",
          (slots ?? []).map((s) => s.id),
        );
      const used = new Map<string, number>();
      (shifts ?? []).forEach(
        (s) => s.slot_id && used.set(s.slot_id, (used.get(s.slot_id) ?? 0) + 1),
      );
      return configs
        .sort((a, b) => (a.modality === "online" ? -1 : 1) - (b.modality === "online" ? -1 : 1))
        .map((c) => ({
          ...c,
          link: `${window.location.origin}/schedule/claim/${c.link_token}`,
          slots: (slots ?? [])
            .filter((s) => s.config_id === c.id)
            .map((s) => ({ ...s, used: used.get(s.id) ?? 0 })),
        }));
    },
  });

  const sendWhatsapp = async (key: string, link: string, pdv: string) => {
    setSending(key);
    try {
      const { shortUrl } = await shortenUrl({ data: { url: link } });
      const message = `A escala da semana de ${format(weekStart, "dd/MM")} (${pdv}) foi liberada. Escolha os turnos em que você vem:\n\n${shortUrl}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Erro ao preparar a mensagem do WhatsApp");
    } finally {
      setSending(null);
    }
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-[var(--surface)]">
          <h3 className="font-bold text-[var(--navy)] text-lg">Links da escala</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-[var(--navy)]"
            aria-label="Fechar"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground uppercase block mb-1">
              Semana (segunda)
            </span>
            <input
              type="date"
              value={weekStr}
              onChange={(e) =>
                e.target.value &&
                setWeekStart(
                  startOfWeek(new Date(`${e.target.value}T00:00:00`), { weekStartsOn: 1 }),
                )
              }
              className="h-10 px-3 rounded-lg border border-border bg-white text-sm"
            />
          </label>

          {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!q.isLoading && (q.data ?? []).length === 0 && (
            <div className="rounded-xl border border-border bg-[var(--surface)] p-6 text-center text-sm text-muted-foreground">
              O administrador ainda não definiu as vagas da sua equipe para esta semana.
            </div>
          )}

          {(q.data ?? []).map((c) => {
            const pdv = labels[locationOfModality(c.modality)];
            const cell = (d: number, period: string) =>
              c.slots.find((s) => s.date === format(days[d], "yyyy-MM-dd") && s.period === period);
            return (
              <section key={c.id} className="rounded-2xl border border-border p-4 space-y-3">
                <h4 className="font-bold text-[var(--navy)]">{pdv}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left py-1 pr-2">Dia</th>
                        {QUOTA_PERIODS.map((p) => (
                          <th key={p.val} className="text-center py-1 px-2">
                            {p.val}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {days.map((day, d) => (
                        <tr key={d}>
                          <td className="py-1.5 pr-2 capitalize whitespace-nowrap">
                            {format(day, "EEE dd/MM", { locale: ptBR })}
                          </td>
                          {QUOTA_PERIODS.map((p) => {
                            const s = cell(d, p.val);
                            return (
                              <td key={p.val} className="py-1.5 px-2 text-center">
                                {s ? (
                                  <span
                                    className={
                                      s.used >= s.capacity
                                        ? "text-muted-foreground"
                                        : "font-semibold text-[var(--navy)]"
                                    }
                                  >
                                    {s.used}/{s.capacity}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Ocupadas / vagas definidas pelo administrador.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(c.link);
                      toast.success("Link copiado!");
                    }}
                    className="h-10 px-4 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-2"
                  >
                    <Copy size={15} /> Copiar link
                  </button>
                  <button
                    type="button"
                    onClick={() => sendWhatsapp(c.id, c.link, pdv)}
                    disabled={sending === c.id}
                    className="h-10 px-4 rounded-xl bg-green-600 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {sending === c.id ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <MessageCircle size={15} />
                    )}{" "}
                    Enviar no WhatsApp
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
