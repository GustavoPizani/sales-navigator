import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, MapPin, Edit2, EyeOff, Eye, Sparkles, Upload, X,
  Loader2, CheckSquare, Square, ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
});

// ─── Types ──────────────────────────────────────────────────────────────────
type Project = {
  id: string;
  name: string;
  address: string;
  city: string;
  description: string | null;
  is_active: boolean;
  manager_id: string;
};

type Typology = {
  type: string;
  area: number;
  vagas: number;
  preco_m2?: number;
  valor_cheio?: number;
  unid_ref?: string;
};

type RichDesc = {
  neighborhood?: string;
  entrega?: string;
  diferencial?: string;
  estrutura?: string;
  typologies?: Typology[];
};

type ExtractedProperty = {
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  diferencial?: string;
  entrega?: string;
  estrutura?: string;
  typologies: Typology[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseDesc(desc: string | null): RichDesc | null {
  if (!desc) return null;
  try { return JSON.parse(desc); } catch { return null; }
}

function fmtBRL(v?: number) {
  if (!v) return null;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function entregaBadge(entrega?: string) {
  if (!entrega) return null;
  if (entrega === "PRONTO") return "bg-green-100 text-green-700";
  if (entrega.toLowerCase().includes("lançamento")) return "bg-purple-100 text-purple-700";
  return "bg-amber-100 text-amber-700";
}

// ─── Groq ────────────────────────────────────────────────────────────────────
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `Você é um especialista em extração de dados de tabelões imobiliários brasileiros.

Extraia TODOS os empreendimentos do tabelão fornecido. O tabelão tem colunas típicas: PROJETO, DIFERENCIAL, ENDEREÇO, BAIRRO, M², TIPO, VAG, PREÇO M², VALOR CHEIO, UNID. REF., ESTRUTURA, ENTREGA.

Várias linhas com o mesmo PROJETO representam tipologias diferentes do mesmo empreendimento.

Retorne um objeto JSON com:
{
  "properties": [
    {
      "name": "Nome exato do empreendimento",
      "address": "Endereço completo",
      "neighborhood": "Bairro",
      "city": "São Paulo (ou Campinas se mencionado explicitamente)",
      "diferencial": "Texto do diferencial (ex: 60m do Metrô)",
      "entrega": "PRONTO ou data como ago-26 ou Breve Lançamento",
      "estrutura": "Texto da estrutura de atendimento (decorado, plantão, etc.)",
      "typologies": [
        {
          "type": "Tipo (Studio, 1 dorm, 2 dorms, 3 dorms, Sala, Laje, etc.)",
          "area": 43.33,
          "vagas": 0,
          "preco_m2": 14328.86,
          "valor_cheio": 407957.00,
          "unid_ref": "1205"
        }
      ]
    }
  ]
}

Regras obrigatórias:
- Agrupe TODAS as tipologias do mesmo projeto em um único objeto
- Converta valores monetários removendo R$, pontos e vírgulas (ex: "R$ 1.179.150,00" → 1179150.00)
- Converta áreas com vírgula para ponto (ex: "43,33" → 43.33)
- Inclua TODOS os projetos encontrados no texto, incluindo lançamentos futuros
- Para seções "FUTUROS LANÇAMENTOS" use entrega: "Breve Lançamento"
- Retorne apenas JSON válido sem markdown ou explicações`;

async function extractFromGroq(text: string): Promise<ExtractedProperty[]> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error("VITE_GROQ_API_KEY não configurado no .env.local");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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
  return Array.isArray(parsed) ? parsed : (parsed.properties ?? []);
}

// ─── PDF text extraction (pdfjs-dist dynamic import) ─────────────────────────
async function extractPDFText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: any) => item.str).join(" ") + "\n\n";
  }
  return text;
}

// ─── Main page ───────────────────────────────────────────────────────────────
function ProjectsPage() {
  const { isAdmin, user } = useAuth();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();

  const projectsQ = useQuery({
    queryKey: ["projects-all", showAll],
    queryFn: async () => {
      let q = supabase.from("projects").select("*").order("created_at", { ascending: false });
      if (!showAll) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Project[];
    },
  });

  const countsQ = useQuery({
    queryKey: ["project-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("appointments").select("project_id");
      const map: Record<string, number> = {};
      (data ?? []).forEach((a: any) => {
        if (a.project_id) map[a.project_id] = (map[a.project_id] || 0) + 1;
      });
      return map;
    },
  });

  return (
    <div className="pb-nav">
      <AppHeader
        title="Imóveis"
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setImporting(true)}
              className="text-white/70 p-2"
              title="Importar do Tabelão com IA"
            >
              <Sparkles size={18} />
            </button>
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-white/70 p-2"
              aria-label="Mostrar inativos"
            >
              {showAll ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>
        }
      />

      <div className="px-4 pt-4 space-y-2">
        {(projectsQ.data ?? []).length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">
            Nenhum imóvel. Toque ✨ para importar do tabelão ou + para adicionar manualmente.
          </p>
        )}
        {(projectsQ.data ?? []).map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            visits={countsQ.data?.[p.id] ?? 0}
            onEdit={() => setEditing(p)}
          />
        ))}
      </div>

      <button
        onClick={() => setEditing("new")}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center"
        aria-label="Adicionar imóvel"
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>

      {editing && (
        <ProjectForm
          project={editing === "new" ? null : editing}
          managerId={user!.id}
          onClose={() => setEditing(null)}
        />
      )}

      {importing && (
        <ImportModal
          managerId={user!.id}
          onClose={() => setImporting(false)}
          onImported={() => {
            qc.invalidateQueries({ queryKey: ["projects-all"] });
            qc.invalidateQueries({ queryKey: ["projects-active"] });
          }}
        />
      )}
    </div>
  );
}

// ─── Project card (rich display) ─────────────────────────────────────────────
function ProjectCard({
  project,
  visits,
  onEdit,
}: {
  project: Project;
  visits: number;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rich = parseDesc(project.description);
  const typologies = rich?.typologies ?? [];

  return (
    <div className={`bg-white rounded-xl border border-border ${!project.is_active ? "opacity-60" : ""}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-[var(--navy)]">
                {project.name}
                {!project.is_active && (
                  <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>
                )}
              </p>
              {rich?.entrega && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${entregaBadge(rich.entrega)}`}>
                  {rich.entrega}
                </span>
              )}
            </div>

            {rich?.diferencial && (
              <p className="text-xs text-[var(--gold)] font-medium mt-0.5">{rich.diferencial}</p>
            )}

            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin size={12} />
              {rich?.neighborhood ?? project.city}
            </p>
            <p className="text-xs text-muted-foreground truncate">{project.address}</p>

            <p className="text-xs text-[var(--gold)] font-semibold mt-1">
              {visits} visita{visits === 1 ? "" : "s"} agendada{visits === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {typologies.length > 0 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-2 text-muted-foreground"
                aria-label="Ver tipologias"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            )}
            <button onClick={onEdit} className="p-2 text-muted-foreground">
              <Edit2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {expanded && typologies.length > 0 && (
        <div className="border-t border-border px-4 pb-3 pt-2 space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Tipologias
          </p>
          {typologies.map((t, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-xs py-2 px-3 bg-[var(--surface)] rounded-lg"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-medium text-[var(--navy)]">{t.type}</span>
                <span className="text-muted-foreground">{t.area}m²</span>
                <span className="text-muted-foreground">{t.vagas} vg</span>
                {t.unid_ref && (
                  <span className="text-muted-foreground">un. {t.unid_ref}</span>
                )}
              </div>
              {t.valor_cheio && (
                <span className="font-semibold text-[var(--navy)] flex-shrink-0">
                  {fmtBRL(t.valor_cheio)}
                </span>
              )}
            </div>
          ))}
          {rich?.estrutura && (
            <p className="text-[10px] text-muted-foreground pt-1 italic">{rich.estrutura}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Import modal ─────────────────────────────────────────────────────────────
function ImportModal({
  managerId,
  onClose,
  onImported,
}: {
  managerId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<"input" | "select">("input");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [extracted, setExtracted] = useState<ExtractedProperty[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setLoadingMsg("Extraindo texto do PDF...");
    try {
      const extracted = await extractPDFText(file);
      setText(extracted);
      toast.success("PDF carregado");
    } catch (err: any) {
      toast.error("Erro ao ler PDF: " + err.message);
    } finally {
      setLoading(false);
      setLoadingMsg("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const analyze = async () => {
    if (!text.trim()) {
      toast.error("Cole o texto do tabelão ou carregue um PDF");
      return;
    }
    setLoading(true);
    setLoadingMsg("Analisando com IA...");
    try {
      const props = await extractFromGroq(text);
      if (!props.length) {
        toast.error("Nenhum imóvel encontrado no texto");
        return;
      }
      setExtracted(props);
      setSelected(new Set(props.map((_, i) => i)));
      setStep("select");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  };

  const toggleAll = () => {
    setSelected(
      selected.size === extracted.length ? new Set() : new Set(extracted.map((_, i) => i))
    );
  };

  const toggle = (i: number) => {
    const s = new Set(selected);
    s.has(i) ? s.delete(i) : s.add(i);
    setSelected(s);
  };

  const importSelected = async () => {
    if (!selected.size) {
      toast.error("Selecione pelo menos um imóvel");
      return;
    }
    setSaving(true);
    try {
      const toInsert = extracted
        .filter((_, i) => selected.has(i))
        .map((p) => ({
          name: p.name,
          address: p.address,
          city: p.city || "São Paulo",
          description: JSON.stringify({
            neighborhood: p.neighborhood,
            entrega: p.entrega,
            diferencial: p.diferencial,
            estrutura: p.estrutura,
            typologies: p.typologies,
          }),
          is_active: true,
          manager_id: managerId,
        }));

      const { error } = await supabase.from("projects").insert(toInsert);
      if (error) throw error;
      toast.success(`${toInsert.length} imóvel(eis) importado(s)`);
      onImported();
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex flex-col" onClick={onClose}>
      <div
        className="bg-white mt-auto rounded-t-2xl flex flex-col"
        style={{ maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <div>
            <h3 className="font-semibold text-[var(--navy)] flex items-center gap-2">
              <Sparkles size={18} className="text-[var(--gold)]" />
              {step === "input" ? "Importar do Tabelão" : `${extracted.length} imóveis encontrados`}
            </h3>
            {step === "select" && (
              <p className="text-xs text-muted-foreground mt-0.5">{selected.size} selecionado(s)</p>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === "input" ? (
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Carregue o PDF do tabelão ou cole o texto abaixo. A IA extrai todos os imóveis automaticamente.
              </p>

              <button
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                className="w-full h-12 rounded-xl border-2 border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors disabled:opacity-50"
              >
                {loading && loadingMsg === "Extraindo texto do PDF..." ? (
                  <><Loader2 size={16} className="animate-spin" /> Extraindo texto...</>
                ) : (
                  <><Upload size={16} /> Carregar PDF do Tabelão</>
                )}
              </button>
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={handleFile} />

              <div className="flex items-center gap-2">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground">ou cole o texto</span>
                <div className="flex-1 border-t border-border" />
              </div>

              <textarea
                className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-border text-sm min-h-[140px] resize-none"
                placeholder="Cole aqui o texto copiado do tabelão (Ctrl+A no PDF, Ctrl+C, cole aqui)..."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          ) : (
            <div className="px-5 py-3 space-y-2">
              <button
                onClick={toggleAll}
                className="flex items-center gap-2 text-sm text-[var(--navy)] font-medium py-1"
              >
                {selected.size === extracted.length ? (
                  <CheckSquare size={16} />
                ) : (
                  <Square size={16} />
                )}
                {selected.size === extracted.length ? "Desmarcar todos" : "Selecionar todos"}
              </button>

              {extracted.map((p, i) => {
                const on = selected.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => toggle(i)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      on ? "border-[var(--navy)] bg-[var(--navy)]/5" : "border-border bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex-shrink-0">
                        {on
                          ? <CheckSquare size={18} className="text-[var(--navy)]" />
                          : <Square size={18} className="text-muted-foreground" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-[var(--navy)]">{p.name}</span>
                          {p.entrega && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${entregaBadge(p.entrega)}`}>
                              {p.entrega}
                            </span>
                          )}
                        </div>

                        {p.diferencial && (
                          <p className="text-xs text-[var(--gold)] mt-0.5">{p.diferencial}</p>
                        )}

                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <MapPin size={10} />
                          {p.neighborhood} · {p.address}
                        </p>

                        {p.typologies?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {p.typologies.map((t, j) => (
                              <span
                                key={j}
                                className="text-[10px] bg-[var(--surface)] text-[var(--navy)] px-2 py-0.5 rounded-full border border-border"
                              >
                                {t.type} · {t.area}m²
                                {t.valor_cheio ? ` · ${fmtBRL(t.valor_cheio)}` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-border flex-shrink-0">
          {step === "input" ? (
            <button
              onClick={analyze}
              disabled={loading || !text.trim()}
              className="w-full h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> {loadingMsg}</>
              ) : (
                <><Sparkles size={18} /> Analisar com IA</>
              )}
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setStep("input")}
                className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
              >
                Voltar
              </button>
              <button
                onClick={importSelected}
                disabled={!selected.size || saving}
                className="flex-1 h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving && <Loader2 size={16} className="animate-spin" />}
                Importar {selected.size > 0 ? `(${selected.size})` : ""}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Project form (manual edit) ───────────────────────────────────────────────
function ProjectForm({
  project,
  managerId,
  onClose,
}: {
  project: Project | null;
  managerId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const rich = parseDesc(project?.description ?? null);
  const [name, setName] = useState(project?.name ?? "");
  const [address, setAddress] = useState(project?.address ?? "");
  const [city, setCity] = useState(project?.city ?? "");
  const [description, setDescription] = useState(rich ? "" : (project?.description ?? ""));
  const [active, setActive] = useState(project?.is_active ?? true);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        address,
        city,
        description: description || null,
        is_active: active,
        manager_id: managerId,
      };
      if (project) {
        const { error } = await supabase.from("projects").update(payload).eq("id", project.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("projects").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects-all"] });
      qc.invalidateQueries({ queryKey: ["projects-active"] });
      toast.success("Salvo");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl p-5 safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-3">
          {project ? "Editar" : "Novo"} imóvel
        </h3>
        <div className="space-y-3">
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Nome do imóvel"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Endereço completo"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <input
            className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border"
            placeholder="Cidade"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          {!rich && (
            <textarea
              className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-border min-h-[80px]"
              placeholder="Descrição (opcional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
          {rich && (
            <p className="text-xs text-muted-foreground px-1">
              Este imóvel foi importado do tabelão — tipologias e preços são gerenciados automaticamente.
            </p>
          )}
          <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border">
            <span className="text-sm font-medium text-[var(--navy)]">Ativo</span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-5 h-5 accent-[var(--gold)]"
            />
          </label>
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={!name || !address || !city || save.isPending}
              className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
