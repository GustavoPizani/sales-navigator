import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Lock, ChevronRight, Loader2, Calendar } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";

// Repare no schedule_ com underline para escapar o layout
export const Route = createFileRoute("/_authenticated/schedule_/claim/$token")({
  component: ClaimShiftPage,
});

function ClaimShiftPage() {
  const { token } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState("");

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id,name")
        .eq("is_active", true)
        .eq("tem_plantao", true)
        .order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // Verifica se o usuário abriu fora do PWA
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
      toast("Para uma melhor experiência, adicione este app à Tela de Início ou abra pelo app instalado.", {
        icon: "📱",
        duration: 5000,
      });
    }
  }, []);

  const configQ = useQuery({
    queryKey: ["shift-config-claim", token],
    queryFn: async () => {
      // Chama a função RPC segura para trazer os detalhes e a CONTAGEM de vagas
      const { data, error } = await supabase.rpc('get_shift_config_by_token', { p_token: token });
      
      if (error) throw error;
      if (!data) throw new Error("Link inválido ou expirado.");
      
      const config = data as any;
      const slotIds = config.slots.map((s: any) => s.id);
      let myClaimedSlotIds = new Set();
      
      // Identifica quais destas vagas O CORRETOR LOGADO já garantiu
      if (slotIds.length > 0) {
        const { data: myShifts } = await supabase
          .from("shifts")
          .select("slot_id")
          .eq("broker_id", user!.id)
          .in("slot_id", slotIds);

        myClaimedSlotIds = new Set((myShifts ?? []).map((s: any) => s.slot_id));
      }

      return { ...config, myClaimedSlotIds };
    },
    enabled: !!user,
  });

  const handleClaim = async (slotId: string) => {
    if (configQ.data?.modality === 'salao' && !selectedProject) {
      toast.error("Selecione o plantão antes de garantir a vaga.");
      return;
    }

    setClaimingId(slotId);
    try {
      const { error } = await supabase.rpc('claim_shift_slot', {
        p_slot_id: slotId,
        p_broker_id: user!.id
      });

      if (error) throw error;
      
      const notesValue = configQ.data?.modality === 'salao' ? selectedProject : 'Central Online';
      await supabase.from("shifts").update({ notes: notesValue }).eq("slot_id", slotId).eq("broker_id", user!.id);

      toast.success("Plantão garantido com sucesso!");
      qc.invalidateQueries({ queryKey: ["shift-config-claim"] });
      qc.invalidateQueries({ queryKey: ["shifts"] });
    } catch (err: any) {
      toast.error(err.message || "Não foi possível garantir a vaga. Ela pode ter esgotado.");
      qc.invalidateQueries({ queryKey: ["shift-config-claim"] }); // Atualiza a contagem na tela
    } finally {
      setClaimingId(null);
    }
  };

  if (configQ.isLoading) {
    return <div className="flex h-screen items-center justify-center bg-[var(--surface)]"><Loader2 className="animate-spin text-[var(--gold)]" size={32} /></div>;
  }

  if (configQ.isError) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4 px-4 text-center bg-[var(--surface)]">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-2"><Lock size={32} /></div>
        <h2 className="text-xl font-bold text-[var(--navy)]">Escala Indisponível</h2>
        <p className="text-muted-foreground">{configQ.error.message}</p>
        <button onClick={() => navigate({ to: "/schedule" })} className="h-11 px-6 rounded-xl bg-[var(--navy)] text-white font-semibold mt-4">Voltar para Minha Escala</button>
      </div>
    );
  }

  const config = configQ.data!;
  const slotsByDate = config.slots.reduce((acc: any, slot: any) => {
    if (!acc[slot.date]) acc[slot.date] = [];
    acc[slot.date].push(slot);
    return acc;
  }, {});

  const sortedDates = Object.keys(slotsByDate).sort();

  return (
    <div className="pb-nav min-h-screen bg-[var(--surface)]">
      <AppHeader title="Garantir Plantão" />
      
      <div className="px-4 pt-4 pb-8 space-y-6">
        <div className="bg-white p-4 rounded-2xl border border-border shadow-sm">
          <div className="flex flex-col mb-1">
            <h2 className="text-lg font-bold text-[var(--navy)]">
              {config.modality === 'online' ? 'Central Online' : 'Plantão Físico'}
            </h2>
          </div>
          <p className="text-sm text-muted-foreground capitalize">
            Semana de {format(parseISO(config.week_start_date), "dd/MM/yyyy")}
          </p>
          {config.modality === 'salao' && (
            <div className="mt-4 pt-4 border-t border-border">
              <label className="text-xs font-bold text-muted-foreground uppercase mb-2 block">Selecione o seu Plantão *</label>
              <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)} className="w-full h-11 px-3 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)] font-medium outline-none focus:border-[var(--gold)]">
                <option value="">Selecione o plantão...</option>
                {(projectsQ.data ?? []).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {sortedDates.map(date => (
            <div key={date}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5 ml-1">
                <Calendar size={14} /> {format(parseISO(date), "EEEE, dd 'de' MMMM", { locale: ptBR })}
              </h3>
              <div className="space-y-2">
                {slotsByDate[date].sort((a: any, b: any) => a.start_time.localeCompare(b.start_time)).map((slot: any) => {
                  const isMine = config.myClaimedSlotIds.has(slot.id);
                  const isSoldOut = slot.claimed_count >= slot.capacity;
                  const isLoading = claimingId === slot.id;
                  const remaining = slot.capacity - slot.claimed_count;

                  if (isMine) return (<button key={slot.id} disabled className="w-full flex items-center justify-between p-4 rounded-xl border border-green-200 bg-green-50 text-green-700 font-semibold cursor-default"><span className="capitalize">{slot.period} <span className="font-normal opacity-80 ml-1">({slot.start_time.slice(0,5)} às {slot.end_time.slice(0,5)})</span></span><div className="flex items-center gap-1.5"><span className="text-[10px] uppercase tracking-wide">Garantido</span><Check size={16} /></div></button>);
                  
                  if (isSoldOut) return (<button key={slot.id} disabled className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-200 bg-gray-100 text-gray-400 font-medium cursor-not-allowed opacity-80"><span className="capitalize">{slot.period} <span className="font-normal opacity-80 ml-1">({slot.start_time.slice(0,5)} às {slot.end_time.slice(0,5)})</span></span><div className="flex items-center gap-1.5"><span className="text-[10px] uppercase font-bold tracking-wide">Esgotado</span><Lock size={16} /></div></button>);

                  return (
                    <button key={slot.id} onClick={() => handleClaim(slot.id)} disabled={isLoading || !!claimingId} className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-white text-[var(--navy)] font-semibold hover:border-[var(--gold)] transition-colors shadow-sm disabled:opacity-50">
                      <span className="capitalize">{slot.period} <span className="font-normal text-muted-foreground ml-1">({slot.start_time.slice(0,5)} às {slot.end_time.slice(0,5)})</span></span>
                      <div className="flex items-center gap-1.5 text-[var(--gold)]">{isLoading ? <Loader2 size={18} className="animate-spin" /> : <><span className="text-[10px] uppercase font-bold tracking-wide">{config.modality === 'salao' ? 'Disponível' : `${remaining} vaga${remaining !== 1 ? 's' : ''} disponível${remaining !== 1 ? 'is' : ''}`}</span><ChevronRight size={18} /></>}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}