import { createFileRoute } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useMemo, useState, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addDays, differenceInDays, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Plus, Trash2, Upload, Loader2, X, Link as LinkIcon, Copy, CheckCircle2, MessageCircle, FileDown } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrokers } from "@/hooks/useBrokers";
import { AppHeader } from "@/components/AppHeader";
import { usePdvLabels } from "@/hooks/useRoulette";
import { TeamQuotaButton } from "@/components/schedule/TeamQuotaEditor";
import { ScheduleLinksButton } from "@/components/schedule/ScheduleLinks";

export const Route = createFileRoute("/_authenticated/schedule")({
  component: SchedulePageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function SchedulePageGuarded() {
  return (
    <RequireModule modules={["schedule"]}>
      <SchedulePage />
    </RequireModule>
  );
}

type Shift = {
  id: string; broker_id: string; manager_id: string; date: string;
  start_time: string; end_time: string; notes: string | null; slot_id: string | null;
};

// ─── Groq ────────────────────────────────────────────────────────────────────
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function extractShiftsFromGroq(text: string, projectNames: string[]): Promise<{ broker_name: string; period: string; day_offset: number; project: string }[]> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error("VITE_GROQ_API_KEY não configurado no .env.local");

  const systemPrompt = `Você é um assistente especializado em processar dados de escalas de corretores.
O usuário enviará o texto extraído de um arquivo CSV com a escala da semana.
A planilha pode conter várias colunas, como o Corretor, o Turno/Período (M para Manhã, T para Tarde, etc) e os dias da semana (Segunda a Domingo).
Seu objetivo é retornar um objeto JSON com os plantões extraídos.

Retorne APENAS um objeto JSON no formato:
{
  "shifts": [
    {
      "broker_name": "NOME DO CORRETOR",
      "period": "M ou T",
      "day_offset": 0,
      "project": "NOME DO PLANTÃO"
    }
  ]
}

Regras:
1. day_offset: 0 para Segunda, 1 para Terça, 2 para Quarta, 3 para Quinta, 4 para Sexta, 5 para Sábado, 6 para Domingo.
2. Ignore dias com "FOLGA" ou células vazias. Retorne apenas dias em que há um projeto/plantão definido.
3. Se identificar projetos chamados "ONLINE", "STAND-BY", "CENTRAL" ou algo parecido, retorne "Online".
4. Os projetos cadastrados no sistema são: ${projectNames.length > 0 ? projectNames.join(", ") : "Nenhum cadastrado"}. Tente mapear o nome do plantão para o nome exato do projeto correspondente.
5. Retorne apenas JSON válido sem markdown ou explicações.
6. Se o corretor estiver escalado em mais de um turno no mesmo dia (ex: Manhã e Tarde), retorne objetos separados para o mesmo day_offset.`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error?.message ?? `Erro ${res.status} na API Groq`);
  }

  const data: any = await res.json();
  const content = data.choices[0].message.content;
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : (parsed.shifts ?? []);
}

function normalizeStr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function matchBroker(name: string, brokers: any[]): any {
  if (!name) return null;
  const norm = normalizeStr(name);
  if (!norm) return null;
  
  let match = brokers.find((b: any) => normalizeStr(b.full_name) === norm);
  if (match) return match;

  const firstName = norm.split(" ")[0];
  match = brokers.find((b: any) => normalizeStr(b.full_name).split(" ")[0] === firstName);
  if (match) return match;

  match = brokers.find((b: any) => normalizeStr(b.full_name).includes(norm) || norm.includes(normalizeStr(b.full_name).split(" ")[0]));
  
  return match || null;
}

function matchProjectName(produto: string, projects: { name: string }[]): string {
  if (!produto) return "";
  const normP = normalizeStr(produto);
  if (normP.includes("online") || normP.includes("on line") || normP.includes("stand by") || normP.includes("standby") || normP.includes("central")) return "Online";
  
  const exact = projects.find((p) => normalizeStr(p.name) === normP);
  if (exact) return exact.name;
  
  const wordsA = normP.split(" ").filter((w) => w.length > 2);
  let best = { score: 0.25, name: "" };
  for (const p of projects) {
    const wordsB = new Set(normalizeStr(p.name).split(" ").filter((w) => w.length > 2));
    const common = wordsA.filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const score = union > 0 ? common / union : 0;
    if (score > best.score) best = { score, name: p.name };
  }
  return best.name;
}

const SHIFT_PERIODS = [
  { val: "Manhã", start: "09:00", end: "14:00" },
  { val: "Tarde", start: "14:00", end: "19:00" },
  { val: "Noite", start: "19:00", end: "23:00" },
];

function ImportScheduleButton({ brokers, currentWeekStart, onImported, managerId }: { brokers: any[]; currentWeekStart: Date; onImported: (d: Date) => void; managerId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(currentWeekStart);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  
  const [parsedData, setParsedData] = useState<{
    weekStart: Date;
    shifts: any[];
    notFound: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").eq("is_active", true).order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setLoadingMsg("Lendo arquivo...");
    
    try {
      const text = await file.text();
      setLoadingMsg("Analisando com IA...");
      
      const projectsList = projectsQ.data ?? [];
      const extracted = await extractShiftsFromGroq(text, projectsList.map(p => p.name));

      if (!extracted || extracted.length === 0) {
        toast.error("Nenhum plantão encontrado no CSV.");
        return;
      }

      const toInsert = [];
      const notFound = new Set<string>();

      for (const shift of extracted) {
        const broker = matchBroker(shift.broker_name, brokers);
        if (!broker) {
          notFound.add(shift.broker_name);
          continue;
        }

        let start_time = "09:00";
        let end_time = "14:00";
        let label_period = "Manhã";
        const periodUpper = shift.period?.toUpperCase() || "";
        if (periodUpper.includes("T")) {
          start_time = "14:00";
          end_time = "19:00";
          label_period = "Tarde";
        } else if (periodUpper.includes("N") || periodUpper.includes("E")) { 
          start_time = "19:00";
          end_time = "23:00";
          label_period = "Noite";
        }

        const finalProject = matchProjectName(shift.project, projectsList);
        if (!finalProject) continue;

        toInsert.push({
          broker_id: broker.id,
          broker_name: broker.full_name,
          day_offset: shift.day_offset,
          start_time,
          end_time,
          label_period,
          notes: finalProject,
        });
      }

      setParsedData({
        weekStart: selectedWeekStart,
        shifts: toInsert,
        notFound: Array.from(notFound)
      });

    } catch (err: any) {
      toast.error(err.message || "Erro ao importar escala");
    } finally {
      setLoading(false);
      setLoadingMsg("");
      e.target.value = "";
    }
  };

  const handleConfirm = async () => {
    if (!parsedData) return;
    setSaving(true);
    try {
      const payload = parsedData.shifts.map(s => ({
        broker_id: s.broker_id,
        manager_id: managerId,
        date: format(addDays(parsedData.weekStart, s.day_offset), "yyyy-MM-dd"),
        start_time: s.start_time,
        end_time: s.end_time,
        notes: s.notes
      }));
      
      const { error } = await supabase.from("shifts").insert(payload);
      if (error) throw error;
      toast.success(`${payload.length} plantões importados!`);
      qc.invalidateQueries({ queryKey: ["shifts"] });
      onImported(parsedData.weekStart);
      setParsedData(null);
      setIsOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar plantões");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button onClick={() => { setSelectedWeekStart(currentWeekStart); setIsOpen(true); }} className="flex items-center justify-center gap-2 h-9 px-4 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold text-sm cursor-pointer hover:opacity-90 transition-opacity">
        <Upload size={16} strokeWidth={2.5} />
        <span className="hidden sm:inline">Importar CSV</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-[var(--surface)]">
              <h3 className="font-bold text-[var(--navy)] text-lg">Importar Escala</h3>
              <button onClick={() => { setIsOpen(false); setParsedData(null); }} className="text-muted-foreground hover:text-[var(--navy)]"><X size={20} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {!parsedData ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1.5">1. Defina a data inicial da semana (Segunda-feira)</label>
                    <input 
                      type="date" 
                      value={format(selectedWeekStart, "yyyy-MM-dd")} 
                      onChange={(e) => {
                        if (e.target.value) {
                          const parts = e.target.value.split('-');
                          const localDate = new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
                          setSelectedWeekStart(startOfWeek(localDate, { weekStartsOn: 1 }));
                        }
                      }} 
                      className="w-full h-11 px-3 rounded-xl bg-white border border-border text-sm text-[var(--navy)]" 
                    />
                    <p className="text-xs text-muted-foreground mt-1.5">Período que será importado: {format(selectedWeekStart, "dd/MM/yyyy")} até {format(addDays(selectedWeekStart, 6), "dd/MM/yyyy")}</p>
                  </div>
                  
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1.5">2. Selecione o arquivo CSV</label>
                    <label className={`w-full h-12 rounded-xl border-2 border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors cursor-pointer ${loading ? "opacity-50 pointer-events-none" : ""}`}>
                      {loading ? (
                        <><Loader2 size={16} className="animate-spin" /> {loadingMsg}</>
                      ) : (
                        <><Upload size={16} /> Carregar CSV da Escala</>
                      )}
                      <input type="file" accept=".csv" className="hidden" onChange={handleFile} disabled={loading} />
                    </label>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center bg-[var(--surface)] p-3 rounded-xl border border-border">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Semana selecionada</p>
                      <p className="font-semibold text-[var(--navy)]">{format(parsedData.weekStart, "dd/MM/yyyy")} até {format(addDays(parsedData.weekStart, 6), "dd/MM/yyyy")}</p>
                    </div>
                  </div>

                  {parsedData.notFound.length > 0 && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
                      <strong>Atenção:</strong> Os seguintes corretores não foram encontrados no sistema e serão ignorados: 
                      <span className="block mt-1 font-medium">{parsedData.notFound.join(", ")}</span>
                    </div>
                  )}

                  <div>
                    <h4 className="font-semibold text-[var(--navy)] mb-2">Plantões identificados ({parsedData.shifts.length})</h4>
                    <div className="border border-border rounded-xl overflow-hidden">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-[var(--surface)] text-[var(--navy)] text-xs uppercase">
                          <tr>
                            <th className="px-3 py-2 border-b border-border">Data</th>
                            <th className="px-3 py-2 border-b border-border">Corretor</th>
                            <th className="px-3 py-2 border-b border-border">Turno</th>
                            <th className="px-3 py-2 border-b border-border">Plantão</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {parsedData.shifts.length === 0 ? (
                            <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Nenhum plantão válido encontrado no arquivo.</td></tr>
                          ) : (
                            parsedData.shifts.map((s, i) => {
                              const d = addDays(parsedData.weekStart, s.day_offset);
                              return (
                                <tr key={i} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 whitespace-nowrap">{format(d, "dd/MM (EEE)", { locale: ptBR })}</td>
                                  <td className="px-3 py-2 font-medium">{s.broker_name}</td>
                                  <td className="px-3 py-2">{s.label_period}</td>
                                  <td className="px-3 py-2 text-[var(--navy)] font-semibold">{s.notes}</td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
            
            <div className="px-5 py-4 border-t border-border bg-[var(--surface)] flex gap-2">
              <button onClick={() => { setIsOpen(false); setParsedData(null); }} className="flex-1 h-11 rounded-xl bg-white border border-border text-[var(--navy)] font-medium">Cancelar</button>
              {parsedData && (
                <button onClick={handleConfirm} disabled={saving || parsedData.shifts.length === 0} className="flex-1 h-11 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-bold disabled:opacity-50 flex justify-center items-center gap-2">
                  {saving ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : "Confirmar e Salvar Escala"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const EXPORT_DAY_LABELS = ["SEGUNDA", "TERÇA", "QUARTA", "QUINTA", "SEXTA", "SÁBADO", "DOMINGO"];

async function exportScheduleXlsx({ weekStart, days, brokers, shifts }: { weekStart: Date; days: Date[]; brokers: any[]; shifts: Shift[] }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Escala");
  const numCols = 1 + days.length;

  ws.columns = [{ width: 6 }, ...days.map(() => ({ width: 18 }))];

  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  const thinBorder = { style: "thin" as const, color: { argb: "FFCCCCCC" } };

  let rowIdx = 1;

  ws.mergeCells(rowIdx, 1, rowIdx, numCols);
  const titleCell = ws.getCell(rowIdx, 1);
  titleCell.value = "PROGRAMAÇÃO - ESCALA";
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = fill("FFC6E8C6");
  ws.getRow(rowIdx).height = 24;
  rowIdx++;

  for (const period of PERIODS) {
    ws.mergeCells(rowIdx, 1, rowIdx, numCols);
    const pCell = ws.getCell(rowIdx, 1);
    pCell.value = period.label.toUpperCase();
    pCell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    pCell.alignment = { horizontal: "center", vertical: "middle" };
    pCell.fill = fill("FF4C9A4C");
    ws.getRow(rowIdx).height = 20;
    rowIdx++;

    const dayRow = ws.getRow(rowIdx);
    days.forEach((_d, i) => {
      const c = dayRow.getCell(i + 2);
      c.value = EXPORT_DAY_LABELS[i];
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.fill = fill("FFF6A821");
    });
    rowIdx++;

    const dateRow = ws.getRow(rowIdx);
    days.forEach((d, i) => {
      const c = dateRow.getCell(i + 2);
      c.value = format(d, "d/M");
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.fill = fill("FF9DC3E6");
    });
    rowIdx++;

    const perDay = days.map((d) => {
      const ds = format(d, "yyyy-MM-dd");
      return shifts
        .filter((s) => s.date === ds && derivePeriod(s.start_time) === period.val)
        .map((s) => brokers.find((b) => b.id === s.broker_id)?.full_name)
        .filter((n): n is string => !!n);
    });
    const maxRows = Math.max(1, ...perDay.map((arr) => arr.length));

    for (let r = 0; r < maxRows; r++) {
      const row = ws.getRow(rowIdx);
      const slotCell = row.getCell(1);
      slotCell.value = r + 1;
      slotCell.alignment = { horizontal: "center" };
      slotCell.fill = fill("FFFFFF99");
      slotCell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      perDay.forEach((names, i) => {
        const c = row.getCell(i + 2);
        c.value = names[r] ?? "";
        c.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
      });
      rowIdx++;
    }

    const totalRow = ws.getRow(rowIdx);
    totalRow.getCell(1).fill = fill("FFF6A821");
    perDay.forEach((names, i) => {
      const c = totalRow.getCell(i + 2);
      c.value = names.length;
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.fill = fill("FFF6A821");
    });
    rowIdx += 2;
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `escala_${format(weekStart, "yyyy-MM-dd")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportScheduleButton({ weekStart, days, brokers, shifts }: { weekStart: Date; days: Date[]; brokers: any[]; shifts: Shift[] }) {
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      await exportScheduleXlsx({ weekStart, days, brokers, shifts });
    } catch (err: any) {
      toast.error(err.message || "Erro ao exportar planilha");
    } finally {
      setExporting(false);
    }
  };
  return (
    <button onClick={handleExport} disabled={exporting} className="flex items-center justify-center gap-2 h-9 px-4 rounded-xl bg-white border border-border text-[var(--navy)] font-bold text-sm cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-60">
      {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} strokeWidth={2.5} />}
      <span className="hidden sm:inline">{exporting ? "Exportando..." : "Exportar Planilha"}</span>
    </button>
  );
}

function SchedulePage() {
  const { isAdmin, isSuperAdmin, user } = useAuth();
  const pdvLabels = usePdvLabels();
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  // Não há mais divisão de corretores por setor: as abas são a modalidade do plantão.
  const [modality, setModality] = useState<"online" | "salao">("online");
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const startStr = format(weekStart, "yyyy-MM-dd");
  const endStr = format(addDays(weekStart, 6), "yyyy-MM-dd");

  // Cada gerente faz a escala da própria equipe; o admin escolhe qual equipe ver/editar.
  const managersQ = useQuery({
    queryKey: ["schedule-managers"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,team_name,color")
        .eq("role", "master")
        .eq("is_active", true)
        .order("team_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  // admin: "all" = todas as equipes juntas, cada uma na cor do gerente
  const [pickedManagerId, setPickedManagerId] = useState<string>("all");
  const managerId = isSuperAdmin ? pickedManagerId : (user?.id ?? "");
  const allTeams = isSuperAdmin && managerId === "all";
  const teams = useMemo(
    () =>
      (managersQ.data ?? []).map((m: any) => ({ id: m.id as string, label: (m.team_name || m.full_name) as string, color: m.color as string })),
    [managersQ.data],
  );

  const brokersQ = useBrokers({ select: "id,full_name,color,role,is_active,manager_id", enabled: isAdmin });
  const brokers = useMemo(
    () => (brokersQ.data ?? []).filter((b: any) => !isSuperAdmin || allTeams || b.manager_id === managerId),
    [brokersQ.data, isSuperAdmin, allTeams, managerId],
  );

  const shiftsQ = useQuery({
    queryKey: ["shifts", startStr, endStr, isAdmin, user?.id],
    queryFn: async () => {
      let q = supabase.from("shifts").select("*").gte("date", startStr).lte("date", endStr);
      if (!isAdmin) q = q.eq("broker_id", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
  });

  const slotsQ = useQuery({
    queryKey: ["shift-slots-capacity", startStr, modality, managerId],
    enabled: isAdmin && !!managerId,
    queryFn: async () => {
      let cq = supabase.from("shift_configs").select("id, manager_id").eq("week_start_date", startStr).eq("modality", modality);
      if (managerId !== "all") cq = cq.eq("manager_id", managerId);
      const { data: configs } = await cq;
      if (!configs?.length) return [];
      const { data } = await supabase
        .from("shift_slots")
        .select("id, date, start_time, end_time, capacity, config_id")
        .in("config_id", configs.map((c) => c.id));
      return (data ?? []) as { id: string; date: string; start_time: string; end_time: string; capacity: number; config_id: string }[];
    },
  });

  // Plantões da modalidade da aba: pela vaga (slot) da configuração da semana;
  // plantões sem vaga vinculada contam como Central Online.
  const modalityShifts = useMemo(() => {
    const slotIds = new Set((slotsQ.data ?? []).map((sl) => sl.id));
    const teamIds = new Set(brokers.map((b: any) => b.id));
    return (shiftsQ.data ?? []).filter(
      (sh) => teamIds.has(sh.broker_id) && (sh.slot_id ? slotIds.has(sh.slot_id) : modality === "online"),
    );
  }, [shiftsQ.data, slotsQ.data, modality, brokers]);

  return (
    <div className="pb-nav">
      <AppHeader title={isAdmin ? "Escala" : "Minha Escala"} />
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-2 rounded-lg bg-white border border-border"><ChevronLeft size={18} /></button>
            <p className="font-semibold text-[var(--navy)] text-sm sm:text-base whitespace-nowrap">{format(weekStart, "dd/MM", { locale: ptBR })} – {format(addDays(weekStart, 6), "dd/MM", { locale: ptBR })}</p>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-2 rounded-lg bg-white border border-border"><ChevronRight size={18} /></button>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              {isSuperAdmin && (
                <TeamQuotaButton teams={teams} defaultManagerId={allTeams ? undefined : managerId} />
              )}
              {!allTeams && (
                <>
                  <ScheduleLinksButton managerId={managerId} />
                  <ImportScheduleButton brokers={brokers} currentWeekStart={weekStart} onImported={setWeekStart} managerId={managerId} />
                </>
              )}
              <ExportScheduleButton weekStart={weekStart} days={days} brokers={brokers} shifts={modalityShifts} />
              {!allTeams && <FixShiftLinksButton managerId={managerId} />}
            </div>
          )}
        </div>

        {isSuperAdmin && (
          <div className="mb-3">
            {(managersQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma equipe ainda. Cadastre os gerentes na tela Time.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={managerId}
                  onChange={(e) => setPickedManagerId(e.target.value)}
                  className="h-10 px-3 rounded-lg bg-white border border-border text-sm"
                  aria-label="Equipe"
                >
                  <option value="all">Todas as equipes</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      Equipe {t.label}
                    </option>
                  ))}
                </select>
                {allTeams && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {teams.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.label}
                      </span>
                    ))}
                  </div>
                )}
                {allTeams && <span className="text-[11px] text-muted-foreground">Para gerar link ou importar, escolha uma equipe.</span>}
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="flex gap-1.5 mb-3 bg-[var(--surface)] p-1 rounded-xl w-fit">
            {([["online", pdvLabels.central], ["salao", pdvLabels.plantao]] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setModality(m)}
                className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors ${
                  modality === m ? "bg-white text-[var(--navy)] shadow-sm" : "text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {isAdmin ? (
          <AdminGrid
            days={days}
            brokers={brokers}
            shifts={modalityShifts}
            slots={slotsQ.data ?? []}
            modality={modality}
            managerId={managerId}
            teams={isSuperAdmin ? teams.filter((t) => allTeams || t.id === managerId) : undefined}
          />
        ) : (
          <BrokerWeek days={days} shifts={shiftsQ.data ?? []} />
        )}
      </div>
    </div>
  );
}

function FixShiftLinksButton({ managerId }: { managerId: string }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!window.confirm("Isso vai vincular turnos preenchidos manualmente às vagas de link correspondentes (mesma data e horário), corrigindo a contagem de vagas disponíveis. Continuar?")) return;
    setRunning(true);
    try {
      const { data: myConfigs, error: cfgErr } = await supabase.from("shift_configs").select("id").eq("manager_id", managerId);
      if (cfgErr) throw cfgErr;
      const configIds = (myConfigs ?? []).map((c) => c.id);
      if (configIds.length === 0) {
        toast("Nenhuma escala com link gerada ainda.", { icon: "ℹ️" });
        return;
      }

      const { data: slots, error: slotsErr } = await supabase
        .from("shift_slots")
        .select("id, date, start_time, end_time")
        .in("config_id", configIds);
      if (slotsErr) throw slotsErr;

      const { data: looseShifts, error: shiftsErr } = await supabase
        .from("shifts")
        .select("id, date, start_time, end_time")
        .eq("manager_id", managerId)
        .is("slot_id", null);
      if (shiftsErr) throw shiftsErr;

      const slotByKey = new Map((slots ?? []).map((s) => [`${s.date}_${s.start_time}_${s.end_time}`, s.id]));
      const toFix = (looseShifts ?? [])
        .map((s) => ({ id: s.id, slotId: slotByKey.get(`${s.date}_${s.start_time}_${s.end_time}`) }))
        .filter((s): s is { id: string; slotId: string } => !!s.slotId);

      if (toFix.length === 0) {
        toast("Nenhum turno solto encontrado — tudo já está vinculado.", { icon: "✅" });
        return;
      }

      const results = await Promise.all(
        toFix.map((s) => supabase.from("shifts").update({ slot_id: s.slotId }).eq("id", s.id))
      );
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) throw failed[0].error;

      qc.invalidateQueries({ queryKey: ["shifts"] });
      toast.success(`${toFix.length} turno(s) vinculado(s) às vagas correspondentes!`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao corrigir vínculos");
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      onClick={run}
      disabled={running}
      className="flex items-center justify-center gap-2 h-9 px-4 rounded-xl bg-white border border-border text-[var(--navy)] font-bold text-sm cursor-pointer hover:bg-gray-50 transition-colors disabled:opacity-60"
    >
      {running ? <Loader2 size={16} className="animate-spin" /> : <LinkIcon size={16} strokeWidth={2.5} />}
      <span className="hidden sm:inline">{running ? "Corrigindo..." : "Corrigir Vínculos"}</span>
    </button>
  );
}

function BrokerWeek({ days, shifts }: { days: Date[]; shifts: Shift[] }) {
  return (
    <div className="space-y-2">
      {days.map((d) => {
        const ds = format(d, "yyyy-MM-dd");
        const my = shifts.filter((s) => s.date === ds);
        return (
          <div key={ds} className="bg-white rounded-xl p-3 border border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{format(d, "EEE, d 'de' MMM", { locale: ptBR })}</p>
            {my.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-1">Sem turno</p>
            ) : (
              my.map((s) => (
                <div key={s.id} className="mt-1.5">
                  <p className="font-semibold text-[var(--navy)]">
                    {derivePeriod(s.start_time) === "manha" ? "Manhã" : (derivePeriod(s.start_time) === "tarde" ? "Tarde" : "Noite")}
                    <span className="font-normal text-muted-foreground text-xs ml-1.5">({s.start_time.slice(0,5)} – {s.end_time.slice(0,5)})</span>
                  </p>
                  <p className="text-xs text-[var(--gold)] font-semibold mt-0.5">{s.notes || "Central Online"}</p>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminGrid({ days, brokers, shifts, slots, modality, managerId, teams }: { days: Date[]; brokers: any[]; shifts: Shift[]; slots: { date: string; start_time: string; end_time: string; capacity: number }[]; modality: "online" | "salao"; managerId: string; teams?: { id: string; label: string; color: string }[] }) {
  // Visão do admin: corretores agrupados por equipe, plantões na cor do gerente.
  const teamById = useMemo(() => new Map((teams ?? []).map((t) => [t.id, t])), [teams]);
  const groups = useMemo(() => {
    if (!teams) return [{ team: null as null | { id: string; label: string; color: string }, brokers }];
    const list = teams.map((t) => ({ team: t as null | { id: string; label: string; color: string }, brokers: brokers.filter((b) => b.manager_id === t.id) }));
    const others = brokers.filter((b) => !teamById.has(b.manager_id));
    if (others.length) list.push({ team: null, brokers: others });
    return list.filter((g) => g.brokers.length > 0);
  }, [teams, brokers, teamById]);
  const chipColor = (b: any) => (teams ? teamById.get(b.manager_id)?.color ?? "#A8A8A8" : b.color);
  const [editing, setEditing] = useState<{ broker: any; date: string; shift?: Shift } | null>(null);
  const brokerIds = useMemo(() => new Set(brokers.map((b) => b.id)), [brokers]);
  const remainingFor = (ds: string, periodVal: "manha" | "tarde" | "noite") => {
    const p = PERIODS.find((x) => x.val === periodVal)!;
    // start_time/end_time voltam do banco como "HH:MM:SS" (coluna time),
    // então compara só os 5 primeiros caracteres ("HH:MM").
    // soma as vagas de todas as equipes exibidas
    const matching = slots.filter((s) => s.date === ds && s.start_time.slice(0, 5) === p.start && s.end_time.slice(0, 5) === p.end);
    if (matching.length === 0) return null;
    const capacity = matching.reduce((sum, s) => sum + s.capacity, 0);
    const occupied = shifts.filter((s) => s.date === ds && derivePeriod(s.start_time) === periodVal && brokerIds.has(s.broker_id)).length;
    return Math.max(0, capacity - occupied);
  };
  return (
    <>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="min-w-full text-xs border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="text-left pb-1"></th>
              {days.map((d) => {
                const ds = format(d, "yyyy-MM-dd");
                const remaining = (["manha", "tarde", "noite"] as const).map((pv) => remainingFor(ds, pv));
                const hasAny = remaining.some((r) => r !== null);
                return (
                  <th key={d.toISOString()} className="text-center font-semibold text-[var(--navy)] pb-1 min-w-[60px]">
                    <div>{format(d, "EEE", { locale: ptBR })}</div>
                    <div className="text-muted-foreground font-normal">{format(d, "d")}</div>
                    {hasAny && (
                      <div className="text-[9px] font-normal text-muted-foreground/60 leading-tight mt-0.5 whitespace-nowrap">
                        M{remaining[0] ?? "–"} T{remaining[1] ?? "–"} N{remaining[2] ?? "–"}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.team?.id ?? "sem-equipe"}>
                {teams && (
                  <tr>
                    <td colSpan={days.length + 1} className="pt-2">
                      <div
                        className="flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-bold text-white"
                        style={{ backgroundColor: g.team?.color ?? "#A8A8A8" }}
                      >
                        Equipe {g.team?.label ?? "sem gerente"} · {g.brokers.length}
                      </div>
                    </td>
                  </tr>
                )}
            {g.brokers.map((b) => (
              <tr key={b.id}>
                <td className="pr-2 py-1 align-middle">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.color }} />
                    <span className="font-medium text-[var(--navy)] whitespace-nowrap">{b.full_name.split(" ")[0]}</span>
                  </div>
                </td>
                {days.map((d) => {
                  const ds = format(d, "yyyy-MM-dd");
                  const dayShifts = shifts.filter((x) => x.broker_id === b.id && x.date === ds);
                  return (
                    <td key={ds} className="align-middle p-0.5">
                      <div className="flex flex-col gap-1 min-h-[48px] justify-center">
                        {dayShifts.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setEditing({ broker: b, date: ds, shift: s })}
                            className="w-full rounded-lg flex items-center justify-center text-[10px] font-semibold leading-tight px-1 py-1 transition-opacity hover:opacity-90"
                            style={{
                              background: chipColor(b),
                              color: "#FFFFFF",
                            }}>
                            <span className="text-center leading-tight">
                              <span className="block font-bold">{derivePeriod(s.start_time) === "manha" ? "M" : (derivePeriod(s.start_time) === "tarde" ? "T" : "N")}</span>
                              <span className="block truncate max-w-[48px] text-[9px] opacity-90">{s.notes || "Online"}</span>
                            </span>
                          </button>
                        ))}
                        {dayShifts.length === 0 && (
                          <button
                            onClick={() => setEditing({ broker: b, date: ds })}
                            className="w-full h-12 rounded-lg flex items-center justify-center text-[10px] font-semibold leading-tight px-1 transition-colors hover:bg-gray-50"
                            style={{
                              background: "#FFFFFF",
                              color: "var(--muted-foreground)",
                              border: "1px dashed var(--border)",
                            }}>
                            <Plus size={14} />
                          </button>
                        )}
                        {dayShifts.length > 0 && dayShifts.length < 3 && (
                          <button
                            onClick={() => setEditing({ broker: b, date: ds })}
                            className="w-full h-5 rounded-lg flex items-center justify-center text-[10px] font-semibold leading-tight px-1 transition-colors hover:bg-gray-100"
                            style={{
                              background: "#FFFFFF",
                              color: "var(--muted-foreground)",
                              border: "1px dashed var(--border)",
                            }}>
                            <Plus size={10} />
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
              </Fragment>
            ))}
            {brokers.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted-foreground py-6">Adicione corretores na aba Time.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <ShiftEditor
          {...editing}
          modality={modality}
          managerId={managerId === "all" ? editing.broker.manager_id : managerId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

const PERIODS = [
  { val: "manha" as const, label: "Manhã", start: "09:00", end: "14:00" },
  { val: "tarde" as const, label: "Tarde", start: "14:00", end: "19:00" },
  { val: "noite" as const, label: "Noite", start: "19:00", end: "23:00" },
];

function derivePeriod(startTime?: string): "manha" | "tarde" | "noite" | null {
  if (!startTime) return null;
  if (startTime.startsWith("08") || startTime.startsWith("07") || startTime.startsWith("06") || startTime.startsWith("09") || startTime.startsWith("10")) return "manha";
  if (startTime.startsWith("13") || startTime.startsWith("12") || startTime.startsWith("14")) return "tarde";
  if (startTime.startsWith("18") || startTime.startsWith("19") || startTime.startsWith("20")) return "noite";
  return null;
}

function ShiftEditor({ broker, date, shift, modality, managerId, onClose }: { broker: any; date: string; shift?: Shift; modality: "online" | "salao"; managerId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<"manha" | "tarde" | "noite" | null>(derivePeriod(shift?.start_time));
  const [plantao, setPlantao] = useState(shift?.notes ?? "");

  const projectsQ = useQuery({
    queryKey: ["projects-active"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id,name").eq("is_active", true).order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!period) throw new Error("Selecione um período (Manhã ou Tarde)");
      const p = PERIODS.find((x) => x.val === period)!;

      // Só é possível preencher a escala manualmente dentro das vagas já
      // configuradas (via "Configurar Escala"/link) para essa semana e
      // modalidade — evita escalar acima da capacidade definida.
      const weekStartStr = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const { data: config } = await supabase
        .from("shift_configs")
        .select("id")
        .eq("manager_id", managerId)
        .eq("week_start_date", weekStartStr)
        .eq("modality", modality)
        .maybeSingle();
      if (!config) {
        throw new Error("Configure as vagas dessa semana primeiro (botão \"Configurar Escala\").");
      }

      const { data: slotRow } = await supabase
        .from("shift_slots")
        .select("id, capacity")
        .eq("config_id", config.id)
        .eq("date", date)
        .eq("start_time", p.start)
        .eq("end_time", p.end)
        .maybeSingle();
      if (!slotRow) {
        throw new Error("Não há vaga configurada para esse turno nessa semana.");
      }

      // Ocupação pela vaga (slot) do turno nesta modalidade.
      let occupiedQuery = supabase
        .from("shifts")
        .select("id", { count: "exact", head: true })
        .eq("slot_id", slotRow.id);
      if (shift) occupiedQuery = occupiedQuery.neq("id", shift.id);
      const { count } = await occupiedQuery;
      if ((count ?? 0) >= slotRow.capacity) {
        throw new Error("Vagas esgotadas para esse turno.");
      }

      const slotId = slotRow.id;

      if (shift) {
        const { error } = await supabase.from("shifts").update({ start_time: p.start, end_time: p.end, notes: plantao || null, slot_id: slotId }).eq("id", shift.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert({ broker_id: broker.id, manager_id: managerId, date, start_time: p.start, end_time: p.end, notes: plantao || null, slot_id: slotId });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shifts"] }); toast.success("Salvo"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async () => { if (shift) { const { error } = await supabase.from("shifts").delete().eq("id", shift.id); if (error) throw error; } },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["shifts"] }); toast.success("Removido"); onClose(); },
  });

  const plantaoOptions = ["Online", ...(projectsQ.data ?? []).map((p) => p.name)];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{format(new Date(date + "T00:00:00"), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-4 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: broker.color }} />{broker.full_name}
        </h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Período</p>
            <div className="grid grid-cols-3 gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.val}
                  onClick={() => setPeriod(p.val)}
                  className={`h-12 rounded-xl font-semibold text-sm transition-colors ${period === p.val ? "bg-[var(--navy)] text-white" : "bg-[var(--surface)] text-[var(--navy)] border border-border"}`}
                >
                  {p.label}
                  <span className="block text-[10px] font-normal opacity-70">{p.start} – {p.end}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Nome do Plantão</p>
            <select
              className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border text-sm text-[var(--navy)]"
              value={plantao}
              onChange={(e) => setPlantao(e.target.value)}
            >
              <option value="">Selecionar plantão...</option>
              {plantaoOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            {shift && <button onClick={() => del.mutate()} className="h-12 px-4 rounded-xl bg-red-50 text-red-600 font-medium flex items-center gap-2"><Trash2 size={16} />Remover</button>}
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancelar</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !period} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
