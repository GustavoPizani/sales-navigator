import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, MapPin, Edit2, EyeOff, Eye, Sparkles, Upload, X,
  Loader2, CheckSquare, Square, ChevronDown, Files, Download,
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
  tem_plantao?: boolean;
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

type ClassifiedFile = {
  file: File;
  projectId: string | null;
  projectName: string;
  type: "tabela" | "book";
};

type ConflictInfo = {
  projectId: string;
  projectName: string;
  type: "tabela" | "book";
  existingFiles: string[];
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

function normalizeProjectName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeStorageKey(filename: string): string {
  const ext = filename.includes(".") ? "." + filename.split(".").pop() : "";
  const base = filename.slice(0, filename.length - ext.length);
  return (
    base
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._\-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") + ext
  );
}

function findExistingProject(
  name: string,
  existing: { id: string; name: string }[]
): { id: string; name: string } | null {
  const norm = normalizeProjectName(name);
  const exact = existing.find((p) => normalizeProjectName(p.name) === norm);
  if (exact) return exact;
  const wordsA = norm.split(" ").filter((w) => w.length > 2);
  let best = { score: 0.4, proj: null as { id: string; name: string } | null };
  for (const p of existing) {
    const wordsB = new Set(normalizeProjectName(p.name).split(" ").filter((w) => w.length > 2));
    const common = wordsA.filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const score = union > 0 ? common / union : 0;
    if (score > best.score) best = { score, proj: p };
  }
  return best.proj;
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

async function classifyFilenamesWithGroq(
  files: File[],
  projects: { id: string; name: string }[]
): Promise<ClassifiedFile[]> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error("VITE_GROQ_API_KEY não configurado");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "Você classifica arquivos de documentos imobiliários. Retorne apenas JSON válido, sem markdown.",
        },
        {
          role: "user",
          content: `Projetos imobiliários existentes:\n${projects.map(p => `- "${p.name}" (ID: ${p.id})`).join("\n")}\n\nArquivos para classificar:\n${files.map((f, i) => `${i + 1}. ${f.name}`).join("\n")}\n\nPara cada arquivo identifique:\n1. O projeto ao qual pertence (busca fuzzy pelo nome no arquivo)\n2. Se é "tabela" (planilha/tabela de preços/tabelão) ou "book" (apresentação/book do produto/material de venda)\n\nRetorne:\n{\n  "files": [\n    {\n      "filename": "nome_exato.pdf",\n      "project_id": "uuid-do-projeto-ou-null",\n      "project_name": "Nome do Projeto",\n      "type": "tabela"\n    }\n  ]\n}`,
        },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`Erro ${res.status} na API Groq`);

  const data: any = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const classified: any[] = parsed.files ?? [];

  return files.map(file => {
    const match = classified.find((c: any) => c.filename === file.name);
    const validProject = projects.find(p => p.id === match?.project_id);
    return {
      file,
      projectId: validProject?.id ?? null,
      projectName: validProject?.name ?? "Não identificado",
      type: (match?.type === "book" ? "book" : "tabela") as "tabela" | "book",
    };
  });
}

// ─── Typology update: extract all raw units + select best per type/area ──────
type RawUnit = {
  type: string;
  area: number;
  vagas: number;
  preco_m2?: number;
  valor_cheio?: number;
  unid_ref?: string;
};

async function extractRawUnitsFromGroq(text: string): Promise<RawUnit[]> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) throw new Error("VITE_GROQ_API_KEY não configurado");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `Você extrai unidades individuais de um tabelão imobiliário brasileiro.
Retorne CADA linha/unidade separada, mesmo que sejam do mesmo tipo e metragem. NÃO agrupe.
Converta valores monetários: remova R$, pontos e vírgulas (ex: "R$ 1.250.000,00" → 1250000).
Converta áreas: vírgula para ponto (ex: "65,33" → 65.33).
Retorne JSON:
{ "units": [{ "type": "2 dorms", "area": 65.33, "vagas": 2, "preco_m2": 12000, "valor_cheio": 780000, "unid_ref": "204" }] }
Retorne apenas JSON válido, sem markdown.`,
        },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`Erro ${res.status} na API Groq`);
  const data: any = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return (parsed.units ?? []) as RawUnit[];
}

function selectTypologiesFromUnits(
  rawUnits: RawUnit[],
  existingTypologies: Typology[]
): Typology[] {
  // Group units by normalized (type, area) key
  const groups = new Map<string, RawUnit[]>();
  for (const unit of rawUnits) {
    const key = `${unit.type.toLowerCase().trim()}|${Math.round(unit.area * 10)}`;
    const g = groups.get(key) ?? [];
    g.push(unit);
    groups.set(key, g);
  }

  const result: Typology[] = [];
  for (const [, units] of groups) {
    if (!units.length) continue;

    // Collect unid_refs already visible for this area range
    const existingRefs = new Set(
      existingTypologies
        .filter(t => Math.abs(t.area - units[0].area) < 1)
        .map(t => t.unid_ref)
        .filter(Boolean)
    );

    // Prefer the unit already referenced; otherwise pick the cheapest
    const preferred = units.find(u => u.unid_ref && existingRefs.has(u.unid_ref));
    const cheapest = units.reduce((a, b) =>
      (a.valor_cheio ?? Infinity) <= (b.valor_cheio ?? Infinity) ? a : b
    );

    const chosen = preferred ?? cheapest;
    result.push({
      type: chosen.type,
      area: chosen.area,
      vagas: chosen.vagas,
      preco_m2: chosen.preco_m2,
      valor_cheio: chosen.valor_cheio,
      unid_ref: chosen.unid_ref,
    });
  }

  return result;
}

// ─── PDF text extraction ─────────────────────────────────────────────────────
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
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
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
          isAdmin ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setUploadingDocs(true)}
                className="text-white/70 p-2"
                title="Upload de Tabela/Book"
              >
                <Files size={18} />
              </button>
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
          ) : null
        }
      />

      <div className="px-4 pt-4 space-y-2">
        {(projectsQ.data ?? []).length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">
            {isAdmin
              ? "Nenhum imóvel. Toque ✨ para importar do tabelão ou + para adicionar manualmente."
              : "Nenhum imóvel disponível no momento."}
          </p>
        )}
        {(projectsQ.data ?? []).map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            visits={countsQ.data?.[p.id] ?? 0}
            onEdit={isAdmin ? () => setEditing(p) : undefined}
          />
        ))}
      </div>

      {isAdmin && (
        <button
          onClick={() => setEditing("new")}
          className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center"
          aria-label="Adicionar imóvel"
        >
          <Plus size={28} strokeWidth={2.5} />
        </button>
      )}

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

      {uploadingDocs && (
        <DocsUploadModal
          onClose={() => setUploadingDocs(false)}
          onUploaded={(projectIds) => {
            projectIds.forEach(id => qc.invalidateQueries({ queryKey: ["project-docs", id] }));
          }}
        />
      )}
    </div>
  );
}

// ─── Project card ─────────────────────────────────────────────────────────────
function ProjectCard({
  project,
  visits,
  onEdit,
}: {
  project: Project;
  visits: number;
  onEdit?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<{ url: string; name: string } | null>(null);
  const rich = parseDesc(project.description);
  const typologies = rich?.typologies ?? [];

  const docsQ = useQuery({
    queryKey: ["project-docs", project.id],
    queryFn: async () => {
      const [{ data: tabelaList }, { data: bookList }] = await Promise.all([
        supabase.storage.from("project-docs").list(`${project.id}/tabela`, { limit: 20 }),
        supabase.storage.from("project-docs").list(`${project.id}/book`, { limit: 20 }),
      ]);

      const sign = async (path: string) => {
        const { data } = await supabase.storage.from("project-docs").createSignedUrl(path, 3600);
        return data?.signedUrl ?? null;
      };

      const tabelas = await Promise.all(
        (tabelaList ?? []).map(async (f) => ({
          name: f.name,
          url: await sign(`${project.id}/tabela/${f.name}`),
        }))
      );
      const books = await Promise.all(
        (bookList ?? []).map(async (f) => ({
          name: f.name,
          url: await sign(`${project.id}/book/${f.name}`),
        }))
      );
      return { tabelas, books };
    },
    enabled: expanded,
    staleTime: 30 * 60 * 1000,
  });

  const hasDocs =
    (docsQ.data?.tabelas.length ?? 0) > 0 || (docsQ.data?.books.length ?? 0) > 0;

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
              {project.tem_plantao && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  Plantão
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
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 text-muted-foreground"
              aria-label="Expandir detalhes"
            >
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              />
            </button>
            {onEdit && (
              <button onClick={onEdit} className="p-2 text-muted-foreground">
                <Edit2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-3 pt-2 space-y-3">
          {typologies.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
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

          {docsQ.isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
              <Loader2 size={12} className="animate-spin" /> Carregando documentos...
            </div>
          )}

          {docsQ.data && hasDocs && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Documentos
              </p>
              <div className="flex flex-wrap gap-2">
                {docsQ.data.tabelas.map((doc, idx) =>
                  doc.url ? (
                    <button
                      key={idx}
                      onClick={() => setViewingDoc({ url: doc.url!, name: doc.name })}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                    >
                      <Eye size={12} />
                      {docsQ.data.tabelas.length > 1 ? `Tabela ${idx + 1}` : "Tabela"}
                    </button>
                  ) : null
                )}
                {docsQ.data.books.map((doc, idx) =>
                  doc.url ? (
                    <button
                      key={idx}
                      onClick={() => setViewingDoc({ url: doc.url!, name: doc.name })}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                    >
                      <Eye size={12} />
                      {docsQ.data.books.length > 1 ? `Book ${idx + 1}` : "Book"}
                    </button>
                  ) : null
                )}
              </div>
            </div>
          )}

          {docsQ.data && !hasDocs && typologies.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">Sem informações adicionais.</p>
          )}
        </div>
      )}

      {viewingDoc && (
        <PdfViewerModal
          url={viewingDoc.url}
          name={viewingDoc.name}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </div>
  );
}

// ─── PDF viewer modal ─────────────────────────────────────────────────────────
function PdfViewerModal({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [loadingPdf, setLoadingPdf] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingPdf(true);
    setPdfDoc(null);
    setNumPages(0);
    canvasRefs.current = [];
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        const doc = await pdfjsLib.getDocument(url).promise;
        if (!cancelled) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setLoadingPdf(false);
        }
      } catch {
        if (!cancelled) setLoadingPdf(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) break;
        const canvas = canvasRefs.current[i - 1];
        if (!canvas) continue;
        try {
          const pdfPage = await pdfDoc.getPage(i);
          if (cancelled) break;
          const dpr = window.devicePixelRatio || 1;
          const displayWidth = Math.min(window.innerWidth - 16, 820);
          const baseViewport = pdfPage.getViewport({ scale: 1 });
          const scale = (displayWidth / baseViewport.width) * dpr;
          const viewport = pdfPage.getViewport({ scale });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${displayWidth}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          const ctx = canvas.getContext("2d")!;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        } catch { /* skip failed page */ }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, numPages]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-[var(--navy)] flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="text-white/70 p-1 flex-shrink-0">
          <X size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{name}</p>
          {numPages > 0 && (
            <p className="text-xs text-white/50">{numPages} páginas</p>
          )}
        </div>
        <a
          href={url}
          download
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 p-1 flex-shrink-0"
          title="Baixar PDF"
        >
          <Download size={20} />
        </a>
      </div>

      {/* Cascade pages */}
      <div
        className="flex-1 overflow-y-auto flex flex-col items-center gap-3 py-3 px-2 bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {loadingPdf ? (
          <div className="flex items-center justify-center h-full w-full">
            <Loader2 size={36} className="animate-spin text-white/60" />
          </div>
        ) : (
          Array.from({ length: numPages }, (_, i) => (
            <canvas
              key={i}
              ref={(el) => { canvasRefs.current[i] = el; }}
              className="rounded shadow-2xl flex-shrink-0"
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Docs upload modal ────────────────────────────────────────────────────────
function DocsUploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: (projectIds: string[]) => void;
}) {
  type TabelaEntry = { projectId: string; projectName: string; files: string[] };

  const qc = useQueryClient();
  const [step, setStep] = useState<"select" | "classify" | "conflict" | "uploading" | "delete-confirm">("select");
  const [uploadingMsg, setUploadingMsg] = useState("Enviando arquivos...");
  const [files, setFiles] = useState<File[]>([]);
  const [classified, setClassified] = useState<ClassifiedFile[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [allTabelas, setAllTabelas] = useState<TabelaEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length) setFiles(prev => [...prev, ...selected]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, i) => i !== index));

  const loadDeleteConfirm = async () => {
    setLoading(true);
    try {
      const { data: projs } = await supabase.from("projects").select("id, name").order("name");
      const list = (projs ?? []) as { id: string; name: string }[];
      const entries: TabelaEntry[] = [];
      for (const p of list) {
        const { data } = await supabase.storage
          .from("project-docs")
          .list(`${p.id}/tabela`, { limit: 50 });
        if (data && data.length > 0) {
          entries.push({ projectId: p.id, projectName: p.name, files: data.map(f => f.name) });
        }
      }
      setAllTabelas(entries);
      setStep("delete-confirm");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmDeleteTabelas = async () => {
    setLoading(true);
    try {
      const paths = allTabelas.flatMap(e =>
        e.files.map(f => `${e.projectId}/tabela/${f}`)
      );
      if (!paths.length) { toast("Nenhuma tabela encontrada para excluir"); onClose(); return; }
      const { error } = await supabase.storage.from("project-docs").remove(paths);
      if (error) throw error;
      toast.success(`${paths.length} tabela(s) excluída(s)`);
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const analyze = async () => {
    if (!files.length) { toast.error("Selecione pelo menos um arquivo"); return; }
    setLoading(true);
    try {
      const { data: existingProjects } = await supabase
        .from("projects")
        .select("id, name")
        .order("name");
      const projs = (existingProjects ?? []) as { id: string; name: string }[];
      setProjects(projs);
      const result = await classifyFilenamesWithGroq(files, projs);
      setClassified(result);
      setStep("classify");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateClassified = (index: number, updates: Partial<Omit<ClassifiedFile, "file">>) => {
    setClassified(prev => prev.map((cf, i) => i === index ? { ...cf, ...updates } : cf));
  };

  const checkConflicts = async () => {
    const toUpload = classified.filter(cf => cf.projectId);
    if (!toUpload.length) { toast.error("Nenhum arquivo com projeto identificado"); return; }

    setLoading(true);
    try {
      const checked = new Set<string>();
      const found: ConflictInfo[] = [];

      for (const cf of toUpload) {
        const key = `${cf.projectId}/${cf.type}`;
        if (checked.has(key)) continue;
        checked.add(key);

        const { data } = await supabase.storage
          .from("project-docs")
          .list(`${cf.projectId}/${cf.type}`, { limit: 20 });

        if (data && data.length > 0) {
          found.push({
            projectId: cf.projectId!,
            projectName: cf.projectName,
            type: cf.type,
            existingFiles: data.map(f => f.name),
          });
        }
      }

      if (found.length > 0) {
        setConflicts(found);
        setStep("conflict");
      } else {
        await doUpload("add");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const doUpload = async (mode: "replace" | "add") => {
    const toUpload = classified.filter(cf => cf.projectId);
    setStep("uploading");
    setUploadingMsg("Enviando arquivos...");
    const uploadedIds = new Set<string>();
    try {
      if (mode === "replace") {
        for (const conflict of conflicts) {
          const paths = conflict.existingFiles.map(
            f => `${conflict.projectId}/${conflict.type}/${f}`
          );
          if (paths.length) await supabase.storage.from("project-docs").remove(paths);
        }
      }

      for (const cf of toUpload) {
        if (!cf.projectId) continue;
        const path = `${cf.projectId}/${cf.type}/${sanitizeStorageKey(cf.file.name)}`;
        const { error } = await supabase.storage
          .from("project-docs")
          .upload(path, cf.file, { upsert: true });
        if (error) throw error;
        uploadedIds.add(cf.projectId);
      }

      toast.success(`${toUpload.length} arquivo(s) enviado(s)`);
      onUploaded(Array.from(uploadedIds));

      // Extract and update typologies from uploaded tabelas
      const tabelaFiles = toUpload.filter(cf => cf.type === "tabela" && cf.projectId);
      if (tabelaFiles.length > 0) {
        let updatedCount = 0;
        for (const cf of tabelaFiles) {
          if (!cf.projectId) continue;
          setUploadingMsg(`Lendo tipologias: ${cf.projectName}...`);
          try {
            const { data: proj } = await supabase
              .from("projects")
              .select("description")
              .eq("id", cf.projectId)
              .maybeSingle();
            const currentDesc: Record<string, any> = proj?.description
              ? JSON.parse(proj.description)
              : {};
            const existingTypologies: Typology[] = currentDesc.typologies ?? [];

            const text = await extractPDFText(cf.file);
            const rawUnits = await extractRawUnitsFromGroq(text);

            if (rawUnits.length > 0) {
              const typologies = selectTypologiesFromUnits(rawUnits, existingTypologies);
              if (typologies.length > 0) {
                await supabase.from("projects").update({
                  description: JSON.stringify({ ...currentDesc, typologies }),
                }).eq("id", cf.projectId!);
                updatedCount++;
                qc.invalidateQueries({ queryKey: ["projects-all"] });
                qc.invalidateQueries({ queryKey: ["projects-for-dashboard"] });
              }
            }
          } catch {
            // Non-blocking — typology update failure doesn't cancel the upload
          }
        }
        if (updatedCount > 0) {
          toast.success(`Tipologias atualizadas em ${updatedCount} imóvel(is)`);
        }
      }

      onClose();
    } catch (err: any) {
      toast.error(err.message);
      setStep("classify");
    }
  };

  const identifiedCount = classified.filter(c => c.projectId).length;

  const stepTitle: Record<typeof step, string> = {
    select: "Upload de Documentos",
    classify: "Revisar Classificação",
    conflict: "Documentos Existentes",
    uploading: "Enviando...",
    "delete-confirm": "Excluir Tabelas",
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
              <Files size={18} className="text-[var(--gold)]" />
              {stepTitle[step]}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {step === "select" && "Tabelas e books por imóvel"}
              {step === "classify" && `${identifiedCount}/${classified.length} identificados pela IA`}
              {step === "conflict" && `${conflicts.length} imóvel(is) já com documentos salvos`}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === "select" && (
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Selecione as tabelas e books. A IA vai identificar automaticamente a qual imóvel cada arquivo pertence.
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full h-12 rounded-xl border-2 border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors"
              >
                <Upload size={16} /> Selecionar arquivos PDF
              </button>
              <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFileChange} />
              {files.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {files.length} arquivo(s)
                  </p>
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 py-2 px-3 bg-[var(--surface)] rounded-lg">
                      <Files size={13} className="text-muted-foreground flex-shrink-0" />
                      <span className="text-sm flex-1 min-w-0 truncate">{f.name}</span>
                      <button onClick={() => removeFile(i)} className="p-0.5 text-muted-foreground flex-shrink-0">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "classify" && (
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Revise os projetos e tipos identificados. Corrija caso necessário antes de enviar.
              </p>
              {classified.map((cf, i) => (
                <div key={i} className="border border-border rounded-xl p-3 space-y-2">
                  <p className="text-sm font-medium text-[var(--navy)] truncate">{cf.file.name}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Projeto</label>
                      <select
                        className="w-full h-9 px-2 rounded-lg bg-[var(--surface)] border border-border text-sm"
                        value={cf.projectId ?? ""}
                        onChange={(e) => {
                          const proj = projects.find(p => p.id === e.target.value);
                          updateClassified(i, {
                            projectId: e.target.value || null,
                            projectName: proj?.name ?? "Não identificado",
                          });
                        }}
                      >
                        <option value="">Não identificado</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Tipo</label>
                      <select
                        className="w-full h-9 px-2 rounded-lg bg-[var(--surface)] border border-border text-sm"
                        value={cf.type}
                        onChange={(e) => updateClassified(i, { type: e.target.value as "tabela" | "book" })}
                      >
                        <option value="tabela">Tabela</option>
                        <option value="book">Book</option>
                      </select>
                    </div>
                  </div>
                  {cf.projectId ? (
                    <p className="text-[10px] text-green-600 font-medium">✓ {cf.projectName}</p>
                  ) : (
                    <p className="text-[10px] text-amber-600 font-medium">⚠ Não identificado — será ignorado no envio</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {step === "conflict" && (
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Os imóveis abaixo já possuem documentos salvos do mesmo tipo. O que deseja fazer?
              </p>
              <div className="space-y-2">
                {conflicts.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5 px-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--navy)] truncate">{c.projectName}</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {c.existingFiles.length} arquivo(s) de {c.type} já salvo(s)
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                      c.type === "tabela" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                    }`}>
                      {c.type === "tabela" ? "Tabela" : "Book"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-1 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  <strong>Substituir:</strong> remove os arquivos existentes e salva os novos.
                </p>
                <p className="text-xs text-muted-foreground">
                  <strong>Acrescentar:</strong> mantém os existentes e adiciona os novos junto.
                </p>
              </div>
            </div>
          )}

          {step === "delete-confirm" && (
            <div className="px-5 py-4 space-y-4">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 size={16} className="animate-spin" /> Buscando tabelas salvas...
                </div>
              ) : allTabelas.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma tabela encontrada no bucket.</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    As tabelas abaixo serão excluídas permanentemente de todos os imóveis:
                  </p>
                  <div className="space-y-2">
                    {allTabelas.map((e, i) => (
                      <div key={i} className="flex items-center gap-3 py-2.5 px-3 bg-red-50 border border-red-200 rounded-xl">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[var(--navy)] truncate">{e.projectName}</p>
                          <p className="text-xs text-red-600 mt-0.5">
                            {e.files.length} tabela(s): {e.files.join(", ")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-red-600 font-medium">
                    Total: {allTabelas.reduce((n, e) => n + e.files.length, 0)} arquivo(s) serão excluídos.
                  </p>
                </>
              )}
            </div>
          )}

          {step === "uploading" && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 size={32} className="animate-spin text-[var(--navy)]" />
              <p className="text-sm text-muted-foreground text-center px-6">{uploadingMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-border flex-shrink-0">
          {step === "select" && (
            <div className="flex flex-col gap-2">
              <button
                onClick={analyze}
                disabled={!files.length || loading}
                className="w-full h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 size={18} className="animate-spin" /> Classificando com IA...</>
                ) : (
                  <><Sparkles size={18} /> Classificar com IA</>
                )}
              </button>
              <button
                onClick={loadDeleteConfirm}
                disabled={loading}
                className="w-full h-10 rounded-xl border border-red-200 text-red-500 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-red-50 transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                Excluir todas as tabelas salvas
              </button>
            </div>
          )}
          {step === "classify" && (
            <div className="flex gap-2">
              <button
                onClick={() => setStep("select")}
                className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
              >
                Voltar
              </button>
              <button
                onClick={checkConflicts}
                disabled={!identifiedCount || loading}
                className="flex-1 h-12 rounded-xl bg-[var(--gold)] text-[var(--navy)] font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                {loading ? "Verificando..." : `Enviar (${identifiedCount})`}
              </button>
            </div>
          )}
          {step === "conflict" && (
            <div className="flex gap-2">
              <button
                onClick={() => doUpload("add")}
                className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-semibold border border-border"
              >
                Acrescentar
              </button>
              <button
                onClick={() => doUpload("replace")}
                className="flex-1 h-12 rounded-xl bg-red-500 text-white font-semibold"
              >
                Substituir
              </button>
            </div>
          )}
          {step === "delete-confirm" && (
            <div className="flex gap-2">
              <button
                onClick={() => setStep("select")}
                className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteTabelas}
                disabled={loading || allTabelas.length === 0}
                className="flex-1 h-12 rounded-xl bg-red-500 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : null}
                {loading ? "Excluindo..." : `Excluir tudo`}
              </button>
            </div>
          )}
        </div>
      </div>
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
  const [existingProjects, setExistingProjects] = useState<{ id: string; name: string }[]>([]);
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
      const [props, { data: existing }] = await Promise.all([
        extractFromGroq(text),
        supabase.from("projects").select("id, name"),
      ]);
      if (!props.length) {
        toast.error("Nenhum imóvel encontrado no texto");
        return;
      }
      setExtracted(props);
      setExistingProjects((existing ?? []) as { id: string; name: string }[]);
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
    let updated = 0;
    let inserted = 0;
    try {
      for (const [idx, p] of extracted.entries()) {
        if (!selected.has(idx)) continue;
        const desc = JSON.stringify({
          neighborhood: p.neighborhood,
          entrega: p.entrega,
          diferencial: p.diferencial,
          estrutura: p.estrutura,
          typologies: p.typologies,
        });
        const match = findExistingProject(p.name, existingProjects);
        if (match) {
          const { error } = await supabase.from("projects").update({
            address: p.address,
            city: p.city || "São Paulo",
            description: desc,
          }).eq("id", match.id);
          if (error) throw error;
          updated++;
        } else {
          const { error } = await supabase.from("projects").insert({
            name: p.name,
            address: p.address,
            city: p.city || "São Paulo",
            description: desc,
            is_active: true,
            manager_id: managerId,
          });
          if (error) throw error;
          inserted++;
        }
      }
      const parts: string[] = [];
      if (updated) parts.push(`${updated} atualizado(s)`);
      if (inserted) parts.push(`${inserted} novo(s)`);
      toast.success(parts.join(", "));
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
                {selected.size === extracted.length ? <CheckSquare size={16} /> : <Square size={16} />}
                {selected.size === extracted.length ? "Desmarcar todos" : "Selecionar todos"}
              </button>

              {extracted.map((p, i) => {
                const on = selected.has(i);
                const existingMatch = findExistingProject(p.name, existingProjects);
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
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${existingMatch ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                            {existingMatch ? "ATUALIZAR" : "NOVO"}
                          </span>
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
                {saving ? "Salvando..." : `Confirmar (${selected.size})`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Project form ─────────────────────────────────────────────────────────────
const INPUT = "w-full h-10 px-3 rounded-lg bg-[var(--surface)] border border-border text-sm";

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
  const [city, setCity] = useState(project?.city ?? "São Paulo");
  const [entrega, setEntrega] = useState(rich?.entrega ?? "");
  const [diferencial, setDiferencial] = useState(rich?.diferencial ?? "");
  const [estrutura, setEstrutura] = useState(rich?.estrutura ?? "");
  const [typologies, setTypologies] = useState<Typology[]>(rich?.typologies ?? []);
  const [active, setActive] = useState(project?.is_active ?? true);
  const [temPlantao, setTemPlantao] = useState(project?.tem_plantao ?? false);

  const addTypology = () =>
    setTypologies((prev) => [...prev, { type: "", area: 0, vagas: 0 }]);

  const updateTypology = (i: number, field: keyof Typology, value: any) =>
    setTypologies((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));

  const removeTypology = (i: number) =>
    setTypologies((prev) => prev.filter((_, idx) => idx !== i));

  const save = useMutation({
    mutationFn: async () => {
      const desc: RichDesc = {
        neighborhood: rich?.neighborhood,
        entrega: entrega || undefined,
        diferencial: diferencial || undefined,
        estrutura: estrutura || undefined,
        typologies: typologies.filter((t) => t.type.trim()),
      };
      const payload = {
        name,
        address,
        city,
        description: JSON.stringify(desc),
        is_active: active,
        tem_plantao: temPlantao,
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
      qc.invalidateQueries({ queryKey: ["projects-for-dashboard"] });
      toast.success("Salvo");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl flex flex-col"
        style={{ maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <h3 className="text-lg font-semibold text-[var(--navy)]">
            {project ? "Editar" : "Novo"} imóvel
          </h3>
          <button onClick={onClose} className="p-1 text-muted-foreground"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Informações básicas</label>
            <input className={INPUT} placeholder="Nome do imóvel *" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={INPUT} placeholder="Endereço completo *" value={address} onChange={(e) => setAddress(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <input className={INPUT} placeholder="Cidade *" value={city} onChange={(e) => setCity(e.target.value)} />
              <input className={INPUT} placeholder="Status obra (ex: PRONTO, ago-26)" value={entrega} onChange={(e) => setEntrega(e.target.value)} />
            </div>
            <input className={INPUT} placeholder="Diferencial (ex: 60m do Metrô)" value={diferencial} onChange={(e) => setDiferencial(e.target.value)} />
            <input className={INPUT} placeholder="Estrutura de atendimento" value={estrutura} onChange={(e) => setEstrutura(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Tipologias</label>
              <button
                onClick={addTypology}
                className="text-xs font-semibold text-[var(--navy)] flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface)] border border-border"
              >
                <Plus size={12} /> Adicionar
              </button>
            </div>
            {typologies.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">Nenhuma tipologia. Clique em Adicionar.</p>
            )}
            {typologies.map((t, i) => (
              <div key={i} className="border border-border rounded-xl p-3 space-y-2 bg-[var(--surface)]/40">
                <div className="flex items-center gap-2">
                  <input
                    className={`${INPUT} flex-1`}
                    placeholder="Tipo (Studio, 2 dorms, Laje...)"
                    value={t.type}
                    onChange={(e) => updateTypology(i, "type", e.target.value)}
                  />
                  <button onClick={() => removeTypology(i)} className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0">
                    <X size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    className={INPUT}
                    placeholder="Área m²"
                    value={t.area || ""}
                    onChange={(e) => updateTypology(i, "area", parseFloat(e.target.value) || 0)}
                  />
                  <input
                    type="number"
                    className={INPUT}
                    placeholder="Vagas"
                    value={t.vagas || ""}
                    onChange={(e) => updateTypology(i, "vagas", parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    className={INPUT}
                    placeholder="Preço/m²"
                    value={t.preco_m2 ?? ""}
                    onChange={(e) => updateTypology(i, "preco_m2", parseFloat(e.target.value) || undefined)}
                  />
                  <input
                    type="number"
                    className={INPUT}
                    placeholder="Valor cheio (R$)"
                    value={t.valor_cheio ?? ""}
                    onChange={(e) => updateTypology(i, "valor_cheio", parseFloat(e.target.value) || undefined)}
                  />
                </div>
                <input
                  className={INPUT}
                  placeholder="Unidade referência"
                  value={t.unid_ref ?? ""}
                  onChange={(e) => updateTypology(i, "unid_ref", e.target.value || undefined)}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border cursor-pointer">
              <span className="text-sm font-medium text-[var(--navy)]">Ativo</span>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="w-5 h-5 accent-[var(--gold)] cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border cursor-pointer">
              <span className="text-sm font-medium text-[var(--navy)]">Tem Plantão</span>
              <input
                type="checkbox"
                checked={temPlantao}
                onChange={(e) => setTemPlantao(e.target.checked)}
                className="w-5 h-5 accent-[var(--gold)] cursor-pointer"
              />
            </label>
          </div>
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-border flex-shrink-0 flex gap-2">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">
            Cancelar
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={!name || !address || !city || save.isPending}
            className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
          >
            {save.isPending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
