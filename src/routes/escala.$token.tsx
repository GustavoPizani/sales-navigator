import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar, Check, Loader2, Lock, Plus, UserPlus, X } from "lucide-react";
import toast from "react-hot-toast";
import { publicSchedule, type PublicSlot } from "@/lib/publicSchedule";

// Página pública (sem login): o gerente abre o link individual gerado pelo
// admin, digita o nome dos corretores e os distribui nos turnos da equipe.
export const Route = createFileRoute("/escala/$token")({
  component: PublicSchedulePage,
});

function PublicSchedulePage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const [week, setWeek] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modality, setModality] = useState<"online" | "salao" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["public-schedule", token, week],
    queryFn: async () => {
      const data = await publicSchedule.load(token, week);
      if (!data)
        throw new Error("Link inválido ou substituído. Peça um novo link ao administrador.");
      return data;
    },
    placeholderData: (prev) => prev,
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["public-schedule", token] });

  const data = q.data;
  const brokers = data?.brokers ?? [];
  const slots = data?.slots ?? [];
  const selected = brokers.find((b) => b.id === selectedId) ?? null;
  const nameById = useMemo(() => new Map(brokers.map((b) => [b.id, b.name])), [brokers]);
  const countByBroker = useMemo(() => {
    const m = new Map<string, number>();
    slots.forEach((s) => s.assigned.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1)));
    return m;
  }, [slots]);

  const modalities = useMemo(
    () => (["online", "salao"] as const).filter((m) => slots.some((s) => s.modality === m)),
    [slots],
  );
  const activeModality = modality && modalities.includes(modality) ? modality : modalities[0];
  const pdvLabel = (m: "online" | "salao") => (m === "online" ? data?.central : data?.plantao);

  const slotsByDate = useMemo(() => {
    const acc: Record<string, PublicSlot[]> = {};
    slots.filter((s) => s.modality === activeModality).forEach((s) => (acc[s.date] ??= []).push(s));
    return acc;
  }, [slots, activeModality]);

  const run = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
    } catch (err: any) {
      toast.error(err.message || "Não foi possível salvar.");
    } finally {
      await refresh();
      setBusy(null);
    }
  };

  const addBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    await run("add", async () => {
      const id = await publicSchedule.addBroker(token, n);
      setName("");
      setSelectedId(id);
    });
  };

  const removeBroker = (id: string) => {
    const turns = countByBroker.get(id) ?? 0;
    const label = nameById.get(id);
    if (
      !window.confirm(
        turns > 0
          ? `Remover ${label}? Os ${turns} turno(s) dele(a) em todas as semanas serão liberados.`
          : `Remover ${label} da lista?`,
      )
    )
      return;
    if (selectedId === id) setSelectedId(null);
    run(`rm-${id}`, () => publicSchedule.removeBroker(token, id));
  };

  const toggleSlot = (slot: PublicSlot) => {
    if (!selected) {
      toast("Escolha primeiro um corretor na lista acima.", { icon: "☝️" });
      return;
    }
    const isIn = slot.assigned.includes(selected.id);
    run(slot.id, () =>
      isIn
        ? publicSchedule.unassign(token, slot.id, selected.id)
        : publicSchedule.assign(token, slot.id, selected.id),
    );
  };

  if (q.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--surface)]">
        <Loader2 className="animate-spin text-[var(--gold)]" size={32} />
      </div>
    );
  }

  if (q.isError || !data) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-3 px-6 text-center bg-[var(--surface)]">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
          <Lock size={32} />
        </div>
        <h2 className="text-xl font-bold text-[var(--navy)]">Escala indisponível</h2>
        <p className="text-muted-foreground">{(q.error as Error | null)?.message}</p>
      </div>
    );
  }

  const sortedDates = Object.keys(slotsByDate).sort();

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-16">
      <header className="bg-[var(--navy)] text-white px-5 py-5">
        <div className="max-w-2xl mx-auto">
          <img
            src="/logo-paes-gregori.webp"
            alt="Paes & Gregori"
            className="h-7 w-auto mb-3"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <h1 className="text-xl font-bold">Escala da Equipe {data.team_name}</h1>
          <p className="text-sm text-white/70">Gerente: {data.manager_name}</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-5">
        {data.weeks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-border p-6 text-center text-sm text-muted-foreground">
            O administrador ainda não definiu as vagas da sua equipe. Volte a este link depois que
            elas forem liberadas.
          </div>
        ) : (
          <div className="bg-white p-4 rounded-2xl border border-border shadow-sm">
            <span className="text-xs font-semibold text-muted-foreground uppercase block mb-2">
              Semana
            </span>
            <div className="flex flex-wrap gap-2">
              {data.weeks.map((w) => (
                <button
                  key={w}
                  onClick={() => setWeek(w)}
                  className={`h-9 px-3 rounded-lg text-sm font-semibold border ${
                    w === data.week
                      ? "bg-[var(--navy)] text-white border-[var(--navy)]"
                      : "bg-white text-[var(--navy)] border-border"
                  }`}
                >
                  {format(parseISO(w), "dd/MM")} a {format(addDays(parseISO(w), 6), "dd/MM")}
                </button>
              ))}
            </div>
          </div>
        )}

        <section className="bg-white p-4 rounded-2xl border border-border shadow-sm">
          <h2 className="font-bold text-[var(--navy)]">1. Corretores da equipe</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Digite o nome de cada corretor. Depois toque em um nome para escalar.
          </p>
          <form onSubmit={addBroker} className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do corretor"
              maxLength={80}
              className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-border bg-white text-sm"
            />
            <button
              type="submit"
              disabled={!name.trim() || busy === "add"}
              className="h-11 px-4 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              {busy === "add" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <UserPlus size={16} />
              )}
              Adicionar
            </button>
          </form>

          {brokers.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {brokers.map((b) => {
                const active = b.id === selectedId;
                return (
                  <span
                    key={b.id}
                    className={`inline-flex items-center rounded-full border text-sm font-semibold ${
                      active
                        ? "bg-[var(--gold)] border-[var(--gold)] text-white"
                        : "bg-white border-border text-[var(--navy)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(active ? null : b.id)}
                      className="h-9 pl-3 pr-1.5 inline-flex items-center gap-1.5"
                    >
                      {b.name}
                      <span
                        className={`text-[11px] font-bold rounded-full px-1.5 ${
                          active ? "bg-white/25" : "bg-[var(--surface)] text-muted-foreground"
                        }`}
                      >
                        {countByBroker.get(b.id) ?? 0}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBroker(b.id)}
                      aria-label={`Remover ${b.name}`}
                      className="h-9 pr-2.5 pl-1 opacity-60 hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {data.weeks.length > 0 && (
          <section className="space-y-4">
            <div className="bg-white p-4 rounded-2xl border border-border shadow-sm">
              <h2 className="font-bold text-[var(--navy)]">
                2. {selected ? `Turnos de ${selected.name}` : "Escolha os turnos"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {selected
                  ? "Escolha o PDV e toque no turno para colocar ou tirar o corretor. As vagas do turno valem para os dois PDVs somados. Salva na hora."
                  : "Toque em um corretor acima e depois nos dias e turnos dele."}
              </p>
              {modalities.length > 1 && (
                <div className="flex gap-1.5 mt-3 bg-[var(--surface)] p-1 rounded-xl w-fit">
                  {modalities.map((m) => (
                    <button
                      key={m}
                      onClick={() => setModality(m)}
                      className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors ${
                        activeModality === m
                          ? "bg-white text-[var(--navy)] shadow-sm"
                          : "text-muted-foreground"
                      }`}
                    >
                      {pdvLabel(m)}
                    </button>
                  ))}
                </div>
              )}
              {modalities.length === 1 && (
                <p className="text-sm font-semibold text-[var(--navy)] mt-2">
                  {pdvLabel(modalities[0])}
                </p>
              )}
            </div>

            {sortedDates.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Sem vagas definidas para esta semana.
              </p>
            )}

            {sortedDates.map((date) => (
              <div key={date}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5 ml-1">
                  <Calendar size={14} />
                  {format(parseISO(date), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                </h3>
                <div className="space-y-2">
                  {slotsByDate[date].map((slot) => {
                    const used = slot.used_total ?? slot.registered + slot.assigned.length;
                    const isIn = !!selected && slot.assigned.includes(selected.id);
                    const full = used >= slot.capacity;
                    const loading = busy === slot.id;
                    const names = slot.assigned.map((id) => nameById.get(id)).filter(Boolean);
                    return (
                      <button
                        key={slot.id}
                        onClick={() => toggleSlot(slot)}
                        disabled={!!busy || (full && !isIn)}
                        className={`w-full text-left p-4 rounded-xl border font-semibold transition-colors shadow-sm ${
                          isIn
                            ? "border-green-200 bg-green-50 text-green-700"
                            : full
                              ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                              : "border-border bg-white text-[var(--navy)] hover:border-[var(--gold)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {slot.period}
                            <span className="font-normal opacity-70 ml-1">
                              ({slot.start_time.slice(0, 5)} às {slot.end_time.slice(0, 5)})
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] uppercase font-bold tracking-wide shrink-0">
                            {used}/{slot.capacity}
                            {loading ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : isIn ? (
                              <Check size={16} />
                            ) : full ? (
                              <Lock size={16} />
                            ) : (
                              <Plus size={16} />
                            )}
                          </span>
                        </div>
                        {(names.length > 0 || slot.registered > 0) && (
                          <p className="text-xs font-normal mt-1 opacity-80">
                            {[
                              ...names,
                              ...(slot.registered > 0
                                ? [`${slot.registered} já cadastrado(s) no app`]
                                : []),
                            ].join(" · ")}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
