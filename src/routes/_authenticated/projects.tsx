import { createFileRoute } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, MapPin, Edit2, EyeOff, Eye, Sparkles, Upload, X,
  Loader2, CheckSquare, Square, ChevronDown, Files, Download, ZoomIn, ZoomOut,
  Search, ArrowUpAZ, ArrowDownAZ, Share2, FileText, ArrowRight, BedDouble, Ruler,
  Car, Bike, Footprints, Image as ImageIcon, RefreshCw, Trash2, ArrowLeft, ClipboardPaste, Save,
} from "lucide-react";
import toast from "react-hot-toast";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function ProjectsPageGuarded() {
  return (
    <RequireModule modules={["projects"]}>
      <ProjectsPage />
    </RequireModule>
  );
}

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
  dorms?: number;
  suites?: number;
  /** planta da tipologia (caminho no storage) */
  plantaPath?: string;
};

type DistanceMode = "carro" | "pe" | "bike";

type DistanceItem = {
  mode: DistanceMode;
  label: string;
  minutes: number;
};

type RichDesc = {
  neighborhood?: string;
  entrega?: string;
  diferencial?: string;
  estrutura?: string;
  typologies?: Typology[];
  /** galeria: a primeira é a capa (coverImagePath aponta para ela) */
  images?: string[];
  /** LANCAMENTO | EM_OBRAS | PRONTO */
  status?: string;
  propertyType?: string;
  coverImagePath?: string;
  amenities?: string[];
  distances?: DistanceItem[];
};

const DISTANCE_MODE_ICON: Record<DistanceMode, typeof Car> = {
  carro: Car,
  pe: Footprints,
  bike: Bike,
};

const DISTANCE_MODE_LABEL: Record<DistanceMode, string> = {
  carro: "De carro",
  pe: "A pé",
  bike: "De bicicleta",
};

function headlineForEntrega(entrega?: string): string {
  if (!entrega) return "Confira esse imóvel";
  if (/pronto/i.test(entrega)) return "Pronto para Morar";
  if (entrega.toLowerCase().includes("lançamento")) return "Breve Lançamento";
  return `Entrega ${entrega}`;
}

function coverRibbonLabel(entrega?: string): string | null {
  if (!entrega) return null;
  const e = entrega.toLowerCase();
  if (/pronto/i.test(entrega)) return "PRONTO";
  if (e.includes("obra")) return "EM OBRAS";
  if (e.includes("lançamento")) return "LANÇAMENTO";
  return null;
}

function dormsRangeLabel(typologies: Typology[]): string | null {
  if (!typologies.length) return null;
  const nums = typologies
    // usa o campo Dorms quando preenchido; senão, o número no nome ("2 dorms")
    .map((t) => t.dorms ?? parseInt(t.type.match(/\d+/)?.[0] ?? "", 10))
    .filter((n) => !Number.isNaN(n));
  const hasStudio = typologies.some((t) => t.type.toLowerCase().includes("studio"));
  if (!nums.length) return hasStudio ? "Studios" : null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = min === max ? `${min} DORM${min > 1 ? "S" : ""}` : `${min} A ${max} DORMS`;
  return hasStudio ? `${range} + STUDIOS` : range;
}

function areaRangeLabel(typologies: Typology[]): string | null {
  const areas = typologies.map((t) => t.area).filter((a) => a > 0);
  if (!areas.length) return null;
  const min = Math.min(...areas);
  const max = Math.max(...areas);
  return min === max ? `${min} M²` : `${min} A ${max} M²`;
}

function priceRange(typologies: Typology[]): { min: number; max: number } | null {
  const prices = typologies.map((t) => t.valor_cheio).filter((v): v is number => !!v);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

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
  type: "tabela" | "book" | "condominio" | "iptu";
};

type ConflictInfo = {
  projectId: string;
  projectName: string;
  type: "tabela" | "book" | "condominio" | "iptu";
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

/** Texto do selo de status no card: sempre escrito do mesmo jeito. */
function entregaLabel(entrega: string): string {
  if (/pronto/i.test(entrega)) return "Pronto";
  if (/lan[çc]amento/i.test(entrega)) return "Lançamento";
  if (/obra/i.test(entrega)) return "Em obras";
  return `Entrega ${entrega}`;
}

function entregaBadge(entrega?: string) {
  if (!entrega) return null;
  if (/pronto/i.test(entrega)) return "bg-green-100 text-green-700";
  if (/lan[çc]amento/i.test(entrega)) return "bg-purple-100 text-purple-700";
  return "bg-amber-100 text-amber-700";
}

async function sharePdf(url: string, filename: string): Promise<void> {
  const safeName = filename.endsWith(".pdf") ? filename : filename + ".pdf";
  const toastId = toast.loading("Preparando PDF…");
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const file = new File([blob], safeName, { type: "application/pdf" });
    toast.dismiss(toastId);
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: safeName });
    } else if (navigator.share) {
      await navigator.share({ url, title: safeName });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = safeName;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (err: any) {
    toast.dismiss(toastId);
    if (err?.name !== "AbortError") toast.error("Não foi possível compartilhar.");
  }
}

async function shareFichaImage(node: HTMLElement, filename: string): Promise<void> {
  const safeName = filename.endsWith(".png") ? filename : filename + ".png";
  const toastId = toast.loading("Gerando imagem da ficha...");
  try {
    const { toBlob } = await import("html-to-image");
    const rect = node.getBoundingClientRect();
    const blob = await toBlob(node, {
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      cacheBust: true,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      style: { width: `${Math.round(rect.width)}px`, height: `${Math.round(rect.height)}px`, margin: "0" },
    });
    if (!blob) throw new Error("Falha ao gerar imagem");
    const file = new File([blob], safeName, { type: "image/png" });
    toast.dismiss(toastId);
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: safeName });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = safeName;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Imagem baixada");
    }
  } catch (err: any) {
    toast.dismiss(toastId);
    if (err?.name !== "AbortError") toast.error(err.message || "Não foi possível gerar a imagem.");
  }
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

// Word-overlap similarity between two project names (Jaccard over words longer than 2 chars).
function projectNameSimilarity(a: string, b: string): number {
  const wordsA = normalizeProjectName(a).split(" ").filter((w) => w.length > 2);
  const wordsB = new Set(normalizeProjectName(b).split(" ").filter((w) => w.length > 2));
  if (!wordsA.length || !wordsB.size) return 0;
  const common = wordsA.filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? common / union : 0;
}

function findExistingProject(
  name: string,
  existing: { id: string; name: string }[]
): { id: string; name: string } | null {
  const norm = normalizeProjectName(name);
  const exact = existing.find((p) => normalizeProjectName(p.name) === norm);
  if (exact) return exact;
  let best = { score: 0.4, proj: null as { id: string; name: string } | null };
  for (const p of existing) {
    const score = projectNameSimilarity(name, p.name);
    if (score > best.score) best = { score, proj: p };
  }
  return best.proj;
}

// ─── Gemini ──────────────────────────────────────────────────────────────────
const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geminiErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const msg = body?.error?.message;
  if (res.status === 503)
    return "A IA do Google está sobrecarregada agora. Já tentamos algumas vezes; aguarde alguns minutos e tente de novo.";
  return msg ? `Erro ${res.status} na API de IA: ${msg}` : `Erro ${res.status} na API de IA`;
}

function geminiText(data: any): string {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

function parseGeminiJson(data: any): any {
  const text = geminiText(data);
  try {
    return JSON.parse(text);
  } catch {
    const truncated = data?.candidates?.[0]?.finishReason === "MAX_TOKENS";
    throw new Error(
      truncated
        ? "Resposta da IA foi cortada (tabela muito grande) — tente dividir o arquivo em partes menores."
        : "Resposta da IA não veio em um JSON válido."
    );
  }
}

// Retries on 429 (rate limit) honoring the Retry-After header, with exponential backoff as fallback.
// Also retries when the model is overloaded or briefly unavailable (500/502/503/504), a few times.
async function fetchGeminiDirect(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  maxRetries = 8
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          maxOutputTokens: 32768,
        },
      }),
    });

    const overloaded = [500, 502, 503, 504].includes(res.status);
    if (overloaded) {
      if (attempt >= 4) return res;
      await sleep(Math.min(2000 * 2 ** attempt, 20000));
      continue;
    }
    if (res.status !== 429 || attempt >= maxRetries) return res;

    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(3000 * 2 ** attempt, 60000);
    await sleep(waitMs);
  }
}

// ─── Groq (principal) ────────────────────────────────────────────────────────
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";

/** Há alguma IA configurada? (Groq é a principal; Gemini fica de reserva.) */
function aiConfigured() {
  return !!(import.meta.env.VITE_GROQ_API_KEY || import.meta.env.VITE_GEMINI_API_KEY);
}

async function fetchGroq(apiKey: string, systemPrompt: string, userContent: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 32768,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      }),
    });
    const transient = [429, 500, 502, 503, 504].includes(res.status);
    if (!transient || attempt >= 3) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    // espera longa demais (limite por minuto estourado): devolve para cair na reserva
    if (retryAfter > 20) return res;
    await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 15000));
  }
}

/**
 * Chamada de IA usada na leitura de tabelões: Groq primeiro; se o Groq falhar
 * (limite, arquivo grande demais, fora do ar) e houver chave do Gemini, usa o
 * Gemini. A resposta volta sempre no formato do Gemini, que o resto do código lê.
 */
async function fetchGemini(
  _apiKey: string,
  systemPrompt: string,
  userContent: string,
): Promise<Response> {
  const groqKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

  if (groqKey) {
    const res = await fetchGroq(groqKey, systemPrompt, userContent);
    if (res.ok) {
      const data: any = await res.json();
      const choice = data?.choices?.[0];
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: choice?.message?.content ?? "{}" }] },
              finishReason: choice?.finish_reason === "length" ? "MAX_TOKENS" : "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!geminiKey) {
      const body: any = await res.json().catch(() => null);
      const msg = body?.error?.message;
      return new Response(
        JSON.stringify({ error: { message: msg ? `Groq: ${msg}` : "Groq indisponível" } }),
        { status: res.status, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  if (!geminiKey) throw new Error("Nenhuma IA configurada (VITE_GROQ_API_KEY).");
  return fetchGeminiDirect(geminiKey, systemPrompt, userContent);
}

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

async function extractFromGemini(text: string): Promise<ExtractedProperty[]> {
  const apiKey = "";
  if (!aiConfigured()) throw new Error("Nenhuma IA configurada (VITE_GROQ_API_KEY).");

  const res = await fetchGemini(apiKey, SYSTEM_PROMPT, text);
  if (!res.ok) throw new Error(await geminiErrorMessage(res));

  const data: any = await res.json();
  const parsed = parseGeminiJson(data);
  return Array.isArray(parsed) ? parsed : (parsed.properties ?? []);
}

async function classifyFilenamesWithGemini(
  files: File[],
  projects: { id: string; name: string }[]
): Promise<ClassifiedFile[]> {
  const apiKey = "";
  if (!aiConfigured()) throw new Error("Nenhuma IA configurada (VITE_GROQ_API_KEY).");

  const systemPrompt = "Você classifica arquivos de documentos imobiliários. Retorne apenas JSON válido, sem markdown.";
  const userContent = `Projetos imobiliários existentes:\n${projects.map(p => `- "${p.name}" (ID: ${p.id})`).join("\n")}\n\nArquivos para classificar:\n${files.map((f, i) => `${i + 1}. ${f.name}`).join("\n")}\n\nPara cada arquivo identifique:\n1. O projeto ao qual pertence (busca fuzzy pelo nome no arquivo)\n2. O tipo: "tabela" (planilha/tabela de preços/tabelão), "book" (apresentação/book do produto/material de venda), "condominio" (boleto/previsão de condomínio) ou "iptu" (boleto/carnê de IPTU)\n\nRetorne:\n{\n  "files": [\n    {\n      "filename": "nome_exato.pdf",\n      "project_id": "uuid-do-projeto-ou-null",\n      "project_name": "Nome do Projeto",\n      "type": "tabela"\n    }\n  ]\n}`;

  const res = await fetchGemini(apiKey, systemPrompt, userContent);
  if (!res.ok) throw new Error(await geminiErrorMessage(res));

  const data: any = await res.json();
  const parsed = parseGeminiJson(data);
  const classified: any[] = parsed.files ?? [];

  return files.map(file => {
    const match = classified.find((c: any) => c.filename === file.name);
    const validProject = projects.find(p => p.id === match?.project_id);
    return {
      file,
      projectId: validProject?.id ?? null,
      projectName: validProject?.name ?? "Não identificado",
      type: (["tabela", "book", "condominio", "iptu"].includes(match?.type) ? match.type : "tabela") as ClassifiedFile["type"],
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
  produto?: string;
};

// Master tabelões cover multiple projects — the AI labels each unit with its source
// "produto", and here (in code, not via the LLM) we keep only units that actually
// belong to the target project. Units without a "produto" label (single-project
// documents) are always kept.
function filterUnitsForProject(units: RawUnit[], projectName: string): RawUnit[] {
  return units.filter((u) => !u.produto || projectNameSimilarity(u.produto, projectName) >= 0.4);
}

async function extractRawUnitsFromGemini(text: string, projectName: string): Promise<RawUnit[]> {
  const apiKey = "";
  if (!aiConfigured()) throw new Error("Nenhuma IA configurada (VITE_GROQ_API_KEY).");

  const systemPrompt = `Você extrai unidades individuais disponíveis de um documento imobiliário brasileiro.
O empreendimento em questão se chama "${projectName}". O documento pode estar em um destes formatos — identifique qual e extraia de acordo:

FORMATO 1 — Tabelão consultivo (cobre MÚLTIPLOS empreendimentos num único arquivo):
Colunas típicas: PROJETO, DIFERENCIAL, ENDEREÇO, BAIRRO, M², TIPO, VAG, PREÇO M², VALOR CHEIO, UNID. REF., ESTRUTURA, ENTREGA. Pode ter seções por região (CENTRO, ZONA OESTE, ZONA SUL, ZONA NORTE, CAMPINAS, LANÇAMENTOS).
Esse formato lista vários empreendimentos diferentes. Extraia as unidades de TODOS os empreendimentos do documento (não filtre, não pule nenhum) — para CADA unidade, preencha o campo "produto" com o nome exato do PROJETO daquela linha (o valor da coluna PROJETO), pra permitir filtrar depois por código.

FORMATO 2 — Tabela de produto (financiamento por pavimento, um único empreendimento):
Organizada por pavimento (ex: "8º PAVIMENTO", "13° PAVIMENTO"), com linhas tipo "Final 4", "Final 5", "Final 6" (posição da unidade no andar), seguidas de uma sequência de vários valores monetários por unidade (ex: valor à vista, entrada/ato, parcela de 30/60 dias, parcela única em 180 vezes, valor total do negócio, valor de financiamento, parcela mensal).
O texto extraído do PDF perde as colunas — os números aparecem em sequência, não alinhados sob seus cabeçalhos. Para identificar o valor_cheio de cada unidade, USE ESTA REGRA: valor_cheio é sempre o MAIOR valor monetário do grupo de números daquela unidade (o "valor total do negócio"/"valor à vista" é sempre o maior; entrada, parcelas e parcela mensal são sempre valores bem menores — nunca escolha um valor pequeno tipo entrada/parcela achando que é o valor cheio).
Não tem coluna de tipologia (dorms/studio) explícita — nesse caso retorne "type": "" (string vazia). Monte o unid_ref combinando pavimento + final quando der pra identificar com certeza (ex: "10-Final 10"); se o pavimento exato for ambíguo (seção cobrindo vários andares), use só o "Final X" como referência. Para vagas, use o valor exato do texto se houver, ou 1 se o documento disser "vaga indefinida"/não especificar. Documento de um único empreendimento — pode omitir "produto" ou preencher com "${projectName}".

FORMATO 3 — Tabela promocional com desconto:
Colunas: UNIDADE, PRODUTO, ÁREA PRIV., VAGA, DE (preço original), DESCONTO (%), POR (preço final). Use a coluna "POR" como valor_cheio (é o preço já com desconto aplicado) — ignore "DE" e "DESCONTO". Pode ter blocos de vários empreendimentos diferentes (cada bloco com seu próprio cabeçalho colorido com o nome do empreendimento) — extraia todos os blocos e preencha "produto" com o nome do empreendimento daquele bloco.

Em todos os formatos:
- Retorne CADA unidade/linha separada, mesmo que repetida. NÃO agrupe.
- Converta valores monetários: remova R$, pontos e vírgulas (ex: "R$ 1.250.000,00" → 1250000).
- Converta áreas: vírgula para ponto (ex: "65,33" → 65.33).
- Ignore linhas sem preço ou área (cabeçalhos, notas de rodapé, unidades já vendidas marcadas com "-").
Retorne JSON:
{ "units": [{ "type": "2 dorms", "area": 65.33, "vagas": 2, "preco_m2": 12000, "valor_cheio": 780000, "unid_ref": "204", "produto": "Nome do Empreendimento" }] }
Retorne apenas JSON válido, sem markdown.`;

  const res = await fetchGemini(apiKey, systemPrompt, text);
  if (!res.ok) throw new Error(await geminiErrorMessage(res));
  const data: any = await res.json();
  const parsed = parseGeminiJson(data);
  const units = (parsed.units ?? []) as RawUnit[];
  return filterUnitsForProject(units, projectName);
}

function selectTypologiesFromUnits(
  rawUnits: RawUnit[],
  existingTypologies: Typology[]
): Typology[] {
  // Backfill missing typology labels (e.g. from floor/financing tables with no "TIPO" column)
  // by matching the unit's area against an already-known typology for this project.
  const withType = rawUnits.map((unit) => {
    if (unit.type.trim()) return unit;
    const match = existingTypologies.find((t) => Math.abs(t.area - unit.area) < 1.5);
    return { ...unit, type: match?.type ?? "Unidade" };
  });

  // Group units by normalized (type, area) key
  const groups = new Map<string, RawUnit[]>();
  for (const unit of withType) {
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
      preco_m2: chosen.valor_cheio && chosen.area ? Math.round(chosen.valor_cheio / chosen.area) : chosen.preco_m2,
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
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

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
  // Catálogo único da empresa: só o admin geral cadastra/edita (gerentes e corretores consultam).
  const { isSuperAdmin: isAdmin, user } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortAZ, setSortAZ] = useState<"none" | "asc" | "desc">("none");
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

  const handleDownloadAllDocs = async () => {
    setDownloadingAll(true);
    const toastId = toast.loading("Buscando imóveis...");
    try {
      const { data: allProjects, error } = await supabase.from("projects").select("id, name");
      if (error) throw error;
      if (!allProjects?.length) {
        toast.error("Nenhum imóvel encontrado.", { id: toastId });
        return;
      }

      const zip = new JSZip();
      const folders = ["tabela", "book", "condominio", "iptu", "capa"];
      let fileCount = 0;

      for (const project of allProjects) {
        const folderName = normalizeProjectName(project.name).replace(/\s+/g, "-") || project.id;
        for (const folder of folders) {
          const { data: list } = await supabase.storage
            .from("project-docs")
            .list(`${project.id}/${folder}`, { limit: 100 });
          if (!list?.length) continue;
          for (const file of list) {
            const path = `${project.id}/${folder}/${file.name}`;
            const { data: blob, error: dlError } = await supabase.storage
              .from("project-docs")
              .download(path);
            if (dlError || !blob) continue;
            zip.file(`${folderName}/${folder}/${file.name}`, blob);
            fileCount++;
            toast.loading(`Baixando arquivos... (${fileCount})`, { id: toastId });
          }
        }
      }

      if (fileCount === 0) {
        toast.error("Nenhum arquivo encontrado no storage.", { id: toastId });
        return;
      }

      toast.loading("Compactando arquivos...", { id: toastId });
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `documentos-imoveis-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      toast.success(`${fileCount} arquivo(s) baixado(s) com sucesso.`, { id: toastId });
    } catch (err: any) {
      toast.error(err.message || "Erro ao baixar arquivos.", { id: toastId });
    } finally {
      setDownloadingAll(false);
    }
  };

  const displayedProjects = (() => {
    let list = projectsQ.data ?? [];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      list = list.filter((p) =>
        p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)
      );
    }
    if (sortAZ !== "none") {
      list = [...list].sort((a, b) =>
        sortAZ === "asc"
          ? a.name.localeCompare(b.name, "pt-BR")
          : b.name.localeCompare(a.name, "pt-BR")
      );
    }
    return list;
  })();

  return (
    <div className="pb-nav">
      <AppHeader
        title="Imóveis"
        right={
          isAdmin ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDownloadAllDocs}
                disabled={downloadingAll}
                className="text-white/70 p-2 disabled:opacity-50"
                title="Baixar todos os documentos (ZIP)"
              >
                {downloadingAll ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              </button>
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

      <div className="px-4 pt-3 flex gap-2 items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar imóvel..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-8 py-2 text-sm rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setSortAZ((s) => s === "none" ? "asc" : s === "asc" ? "desc" : "none")}
          title={sortAZ === "asc" ? "A → Z (clique para Z → A)" : sortAZ === "desc" ? "Z → A (clique para desativar)" : "Ordenar A → Z"}
          className={`p-2 rounded-xl border transition-colors ${sortAZ !== "none" ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10" : "border-border text-muted-foreground"}`}
        >
          {sortAZ === "desc" ? <ArrowDownAZ size={18} /> : <ArrowUpAZ size={18} />}
        </button>
      </div>

      <div className="px-4 pt-3 space-y-2">
        {displayedProjects.length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">
            {searchQuery
              ? `Nenhum imóvel encontrado para "${searchQuery}".`
              : isAdmin
              ? "Nenhum imóvel. Toque ✨ para importar do tabelão ou + para adicionar manualmente."
              : "Nenhum imóvel disponível no momento."}
          </p>
        )}
        {displayedProjects.map((p) => (
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

// ─── Fichas tab ───────────────────────────────────────────────────────────────
function FichasTab({ projects }: { projects: Project[] }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeProjects = projects.filter((p) => p.is_active);
  const filtered = (() => {
    if (!search.trim()) return activeProjects;
    const q = search.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return activeProjects.filter((p) =>
      p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)
    );
  })();

  const selected = activeProjects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="px-4 pt-3">
      <div className="lg:grid lg:grid-cols-[300px_1fr] lg:gap-4 lg:items-start">
        {/* Selector — always visible on desktop, collapses on mobile/tablet once a property is picked */}
        <div className={selected ? "hidden lg:block" : "block"}>
          <p className="text-sm text-muted-foreground mb-3">
            Escolha um imóvel para gerar a ficha de produto.
          </p>

          <div className="relative mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar imóvel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-8 py-2 text-sm rounded-xl border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--gold)]/40"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="space-y-1.5 lg:max-h-[70vh] max-h-[50vh] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-6 text-sm">
                Nenhum imóvel encontrado.
              </p>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                  selectedId === p.id
                    ? "border-[var(--gold)] bg-[var(--gold)]/10"
                    : "border-border bg-white hover:border-[var(--gold)]/50"
                }`}
              >
                <p className="text-sm font-medium text-[var(--navy)]">{p.name}</p>
                <p className="text-xs text-muted-foreground truncate">{p.address}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Mobile/tablet-only compact bar shown once a property is selected, tap to change it */}
        {selected && (
          <button
            onClick={() => setSelectedId(null)}
            className="lg:hidden w-full flex items-center justify-between gap-2 px-3 py-2.5 mb-3 rounded-xl border border-[var(--gold)] bg-[var(--gold)]/10"
          >
            <div className="min-w-0 text-left">
              <p className="text-sm font-medium text-[var(--navy)] truncate">{selected.name}</p>
              <p className="text-xs text-muted-foreground truncate">{selected.address}</p>
            </div>
            <span className="text-xs text-[var(--gold)] font-semibold flex-shrink-0">Trocar</span>
          </button>
        )}

        {/* Ficha panel */}
        <div>
          {selected ? (
            <FichaPreview project={selected} />
          ) : (
            <div className="hidden lg:flex items-center justify-center min-h-[300px] border border-dashed border-border rounded-xl text-sm text-muted-foreground">
              Selecione um imóvel ao lado para ver a ficha.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FichaPreview({ project }: { project: Project }) {
  const { profile } = useAuth();
  const rich = parseDesc(project.description);
  const typologies = rich?.typologies ?? [];
  const amenities = rich?.amenities ?? [];
  const distances = rich?.distances ?? [];
  const dorms = dormsRangeLabel(typologies);
  const area = areaRangeLabel(typologies);
  const ribbon = coverRibbonLabel(rich?.entrega);
  const prices = priceRange(typologies);
  const cardRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

  const coverQ = useQuery({
    queryKey: ["project-cover", project.id],
    queryFn: async () => {
      if (!rich?.coverImagePath) return null;
      const { data } = await supabase.storage
        .from("project-docs")
        .createSignedUrl(rich.coverImagePath, 3600);
      return data?.signedUrl ?? null;
    },
    enabled: !!rich?.coverImagePath,
    staleTime: 30 * 60 * 1000,
  });

  const handleShare = async () => {
    if (!cardRef.current) return;
    setSharing(true);
    try {
      await shareFichaImage(cardRef.current, `ficha-${normalizeProjectName(project.name).replace(/\s+/g, "-")}`);
    } finally {
      setSharing(false);
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--navy)] text-white disabled:opacity-50"
        >
          {sharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
          Compartilhar ficha
        </button>
      </div>

      <div ref={cardRef} className="relative bg-white rounded-2xl border border-border shadow-sm mx-auto p-4 sm:p-6 w-full max-w-[880px]">
      {/* Top row: entrega badge */}
      {rich?.entrega && (
        <span className="text-[10px] sm:text-xs font-semibold px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-[var(--navy)] text-white whitespace-nowrap">
          Entrega: {rich.entrega}
        </span>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 mt-4">
        {/* Left column */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ArrowRight size={20} className="text-[var(--gold)] flex-shrink-0" />
            <h2 className="text-xl sm:text-2xl font-bold text-[var(--navy)]">{headlineForEntrega(rich?.entrega)}</h2>
          </div>

          {rich?.diferencial && (
            <p className="text-[var(--gold)] font-medium mt-3 text-sm">{rich.diferencial}</p>
          )}

          <p className="font-semibold text-[var(--navy)] mt-3">{project.name}</p>

          {(dorms || area) && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-sm text-[var(--navy)]">
              {dorms && (
                <div className="flex items-center gap-2">
                  <BedDouble size={20} className="text-[var(--gold)] flex-shrink-0" />
                  <span className="font-semibold">{dorms}</span>
                </div>
              )}
              {area && (
                <div className="flex items-center gap-2">
                  <Ruler size={20} className="text-[var(--gold)] flex-shrink-0" />
                  <span className="font-semibold">{area}</span>
                </div>
              )}
            </div>
          )}

          {amenities.length > 0 && (
            <div className="flex items-start gap-3 mt-4">
              <span className="text-[10px] font-bold text-[var(--gold)] border border-[var(--gold)] rounded-lg px-2.5 py-2 flex-shrink-0 whitespace-nowrap">
                LAZER COMPLETO
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {amenities.join(" · ")}
              </p>
            </div>
          )}

          {distances.length > 0 && (
            <div className="mt-5 space-y-1.5">
              {distances.map((d, i) => {
                const Icon = DISTANCE_MODE_ICON[d.mode];
                return (
                  <div key={i} className="flex items-center gap-2 text-xs text-[var(--navy)]">
                    <Icon size={14} className="text-muted-foreground flex-shrink-0" />
                    <span>
                      {d.label} - <b className="text-[var(--gold)]">{d.minutes} MINUTOS</b>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 text-xs text-muted-foreground">
            <p className="uppercase break-words">{project.address}{rich?.neighborhood ? ` – ${rich.neighborhood}` : ""}</p>
          </div>

          {prices && (
            <p className="mt-5 text-sm text-[var(--navy)]">
              À partir de <b>{fmtBRL(prices.min)}</b> até <b>{fmtBRL(prices.max)}</b>
            </p>
          )}
        </div>

        {/* Right column: cover photo + broker */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative rounded-2xl overflow-hidden border-2 border-[var(--gold)] bg-[var(--surface)] flex items-center justify-center flex-shrink-0 w-full max-w-[220px] lg:max-w-none aspect-[4/5] mx-auto">
            {coverQ.data ? (
              <img src={coverQ.data} alt={project.name} crossOrigin="anonymous" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon size={40} className="text-muted-foreground/40" />
            )}
            {ribbon && (
              <div className="absolute top-4 -right-9 w-32 rotate-45 bg-[var(--gold)] text-[var(--navy)] text-[10px] font-bold py-1 text-center shadow-sm">
                {ribbon}
              </div>
            )}
          </div>

          {profile && (
            <div className="flex items-center gap-2.5 w-full max-w-[220px] lg:max-w-none justify-center">
              <Avatar name={profile.full_name} color={profile.color} size={52} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--navy)] truncate">{profile.full_name}</p>
                {profile.phone && (
                  <p className="text-xs text-muted-foreground">Contato: {profile.phone}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── Tipologias table (padrão visual do Tabelão) ──────────────────────────────
function TipologiasTable({ typologies }: { typologies: Typology[] }) {
  if (typologies.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left font-semibold text-white bg-[var(--navy)] px-3 py-2 whitespace-nowrap">
              Unidade
            </th>
            <th className="text-left font-semibold text-white bg-[var(--navy)] px-3 py-2 whitespace-nowrap">
              Tipologia
            </th>
            <th className="text-left font-semibold text-white bg-[var(--navy)] px-3 py-2 whitespace-nowrap">
              Área Priv.
            </th>
            <th className="text-left font-semibold text-white bg-[var(--navy)] px-3 py-2 whitespace-nowrap">
              Vaga
            </th>
            <th className="text-left font-semibold text-white bg-[var(--navy)] px-3 py-2 whitespace-nowrap">
              Preço/m²
            </th>
            <th className="text-left font-semibold text-white bg-[var(--navy)] px-3 py-2 whitespace-nowrap">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {typologies.map((t, i) => (
            <tr key={i} className="border-t border-border even:bg-[var(--surface)]/40">
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {t.unid_ref ?? "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap font-medium text-[var(--navy)]">
                {t.type}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {t.area}m²
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {t.vagas}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {t.preco_m2 ? fmtBRL(t.preco_m2) : "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap font-semibold text-[var(--navy)]">
                {t.valor_cheio ? fmtBRL(t.valor_cheio) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      const [{ data: tabelaList }, { data: bookList }, { data: condominioList }, { data: iptuList }] = await Promise.all([
        supabase.storage.from("project-docs").list(`${project.id}/tabela`, { limit: 20 }),
        supabase.storage.from("project-docs").list(`${project.id}/book`, { limit: 20 }),
        supabase.storage.from("project-docs").list(`${project.id}/condominio`, { limit: 20 }),
        supabase.storage.from("project-docs").list(`${project.id}/iptu`, { limit: 20 }),
      ]);

      const sign = async (path: string) => {
        const { data } = await supabase.storage.from("project-docs").createSignedUrl(path, 3600);
        return data?.signedUrl ?? null;
      };

      const mapFiles = (list: typeof tabelaList, folder: string) =>
        Promise.all((list ?? []).map(async (f) => ({
          name: f.name,
          url: await sign(`${project.id}/${folder}/${f.name}`),
        })));

      const [tabelas, books, condominios, iptus] = await Promise.all([
        mapFiles(tabelaList, "tabela"),
        mapFiles(bookList, "book"),
        mapFiles(condominioList, "condominio"),
        mapFiles(iptuList, "iptu"),
      ]);
      return { tabelas, books, condominios, iptus };
    },
    enabled: expanded,
    staleTime: 30 * 60 * 1000,
  });

  const hasDocs =
    (docsQ.data?.tabelas.length ?? 0) > 0 || (docsQ.data?.books.length ?? 0) > 0 ||
    (docsQ.data?.condominios.length ?? 0) > 0 || (docsQ.data?.iptus.length ?? 0) > 0;

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
                  {entregaLabel(rich.entrega)}
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
              {rich?.neighborhood || project.city}
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
                    <div key={idx} className="flex items-stretch rounded-lg border border-amber-200 overflow-hidden">
                      <button
                        onClick={() => setViewingDoc({ url: doc.url!, name: doc.name })}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                      >
                        <Eye size={12} />
                        {docsQ.data.tabelas.length > 1 ? `Tabela ${idx + 1}` : "Tabela"}
                      </button>
                      <div className="w-px bg-amber-200" />
                      <button
                        onClick={() => sharePdf(doc.url!, doc.name)}
                        title="Compartilhar"
                        className="flex items-center px-2 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                      >
                        <Share2 size={12} />
                      </button>
                    </div>
                  ) : null
                )}
                {docsQ.data.books.map((doc, idx) =>
                  doc.url ? (
                    <div key={idx} className="flex items-stretch rounded-lg border border-blue-200 overflow-hidden">
                      <button
                        onClick={() => setViewingDoc({ url: doc.url!, name: doc.name })}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        <Eye size={12} />
                        {docsQ.data.books.length > 1 ? `Book ${idx + 1}` : "Book"}
                      </button>
                      <div className="w-px bg-blue-200" />
                      <button
                        onClick={() => sharePdf(doc.url!, doc.name)}
                        title="Compartilhar"
                        className="flex items-center px-2 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        <Share2 size={12} />
                      </button>
                    </div>
                  ) : null
                )}
                {docsQ.data.condominios.map((doc, idx) =>
                  doc.url ? (
                    <div key={idx} className="flex items-stretch rounded-lg border border-green-200 overflow-hidden">
                      <button
                        onClick={() => setViewingDoc({ url: doc.url!, name: doc.name })}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                      >
                        <Eye size={12} />
                        {docsQ.data.condominios.length > 1 ? `Condomínio ${idx + 1}` : "Condomínio"}
                      </button>
                      <div className="w-px bg-green-200" />
                      <button
                        onClick={() => sharePdf(doc.url!, doc.name)}
                        title="Compartilhar"
                        className="flex items-center px-2 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                      >
                        <Share2 size={12} />
                      </button>
                    </div>
                  ) : null
                )}
                {docsQ.data.iptus.map((doc, idx) =>
                  doc.url ? (
                    <div key={idx} className="flex items-stretch rounded-lg border border-purple-200 overflow-hidden">
                      <button
                        onClick={() => setViewingDoc({ url: doc.url!, name: doc.name })}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
                      >
                        <Eye size={12} />
                        {docsQ.data.iptus.length > 1 ? `IPTU ${idx + 1}` : "IPTU"}
                      </button>
                      <div className="w-px bg-purple-200" />
                      <button
                        onClick={() => sharePdf(doc.url!, doc.name)}
                        title="Compartilhar"
                        className="flex items-center px-2 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
                      >
                        <Share2 size={12} />
                      </button>
                    </div>
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
  const [zoom, setZoom] = useState(1);

  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

  useEffect(() => {
    let cancelled = false;
    setLoadingPdf(true);
    setPdfDoc(null);
    setNumPages(0);
    setZoom(1);
    canvasRefs.current = [];
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
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
          const baseDisplayWidth = Math.min(window.innerWidth - 16, 820);
          const displayWidth = baseDisplayWidth * zoom;
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
  }, [pdfDoc, numPages, zoom]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black flex flex-col"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 bg-[var(--navy)] flex-shrink-0"
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
        <button
          onClick={() => setZoom(z => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(z) - 1)])}
          disabled={zoom <= ZOOM_STEPS[0]}
          className="text-white/70 p-1 flex-shrink-0 disabled:opacity-30"
          title="Diminuir zoom"
        >
          <ZoomOut size={20} />
        </button>
        <span className="text-white/60 text-xs w-9 text-center flex-shrink-0">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(z) + 1)])}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          className="text-white/70 p-1 flex-shrink-0 disabled:opacity-30"
          title="Aumentar zoom"
        >
          <ZoomIn size={20} />
        </button>
        <a
          href={url}
          download
          onClick={(e) => e.stopPropagation()}
          className="text-white/70 p-1 flex-shrink-0"
          title="Baixar PDF"
        >
          <Download size={20} />
        </a>
        <button
          onClick={(e) => { e.stopPropagation(); sharePdf(url, name); }}
          className="text-white/70 p-1 flex-shrink-0"
          title="Compartilhar PDF"
        >
          <Share2 size={20} />
        </button>
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
      const result = await classifyFilenamesWithGemini(files, projs);
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
            const rawUnits = await extractRawUnitsFromGemini(text, cf.projectName);

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
                        onChange={(e) => updateClassified(i, { type: e.target.value as ClassifiedFile["type"] })}
                      >
                        <option value="tabela">Tabela</option>
                        <option value="book">Book</option>
                        <option value="condominio">Condomínio</option>
                        <option value="iptu">IPTU</option>
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
                      c.type === "tabela" ? "bg-amber-100 text-amber-700"
                        : c.type === "book" ? "bg-blue-100 text-blue-700"
                        : c.type === "condominio" ? "bg-green-100 text-green-700"
                        : "bg-purple-100 text-purple-700"
                    }`}>
                      {{ tabela: "Tabela", book: "Book", condominio: "Condomínio", iptu: "IPTU" }[c.type]}
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

// ─── Clear typologies modal ────────────────────────────────────────────────────
function ClearTypologiesModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"confirm" | "running" | "done">("confirm");
  const [count, setCount] = useState(0);

  const run = async () => {
    setStep("running");
    try {
      const { data: projects, error } = await supabase
        .from("projects")
        .select("id, description");
      if (error) throw error;

      let cleared = 0;
      for (const p of (projects ?? []) as { id: string; description: string | null }[]) {
        const currentDesc: Record<string, any> = p.description ? JSON.parse(p.description) : {};
        if (!currentDesc.typologies || currentDesc.typologies.length === 0) continue;
        const { error: updError } = await supabase
          .from("projects")
          .update({ description: JSON.stringify({ ...currentDesc, typologies: [] }) })
          .eq("id", p.id);
        if (!updError) cleared++;
      }

      setCount(cleared);
      setStep("done");
      onDone();
    } catch (err: any) {
      toast.error(err.message);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex flex-col" onClick={step === "running" ? undefined : onClose}>
      <div
        className="bg-white mt-auto rounded-t-2xl flex flex-col"
        style={{ maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <h3 className="font-semibold text-[var(--navy)] flex items-center gap-2">
            <Trash2 size={18} className="text-red-500" />
            Limpar Tipologias
          </h3>
          {step !== "running" && (
            <button onClick={onClose} className="p-1 text-muted-foreground"><X size={18} /></button>
          )}
        </div>

        <div className="px-5 py-5">
          {step === "confirm" && (
            <p className="text-sm text-muted-foreground">
              Isso vai apagar o array de tipologias de <strong>todos</strong> os imóveis no banco
              (endereço, bairro, fotos e demais dados são mantidos). Essa ação não pode ser desfeita.
            </p>
          )}
          {step === "running" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 size={16} className="animate-spin" /> Limpando tipologias...
            </div>
          )}
          {step === "done" && (
            <p className="text-sm text-[var(--navy)]">
              Tipologias limpas em <strong>{count}</strong> imóvel(is).
            </p>
          )}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-border flex-shrink-0 flex gap-2">
          {step === "confirm" && (
            <>
              <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">
                Cancelar
              </button>
              <button onClick={run} className="flex-1 h-12 rounded-xl bg-red-500 text-white font-semibold">
                Limpar tudo
              </button>
            </>
          )}
          {step === "done" && (
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold">
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Reprocess typologies modal ───────────────────────────────────────────────
type ReprocessLogEntry = { projectName: string; status: "ok" | "sem-tabela" | "erro"; detail?: string };

function ReprocessTypologiesModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [running, setRunning] = useState(true);
  const [currentMsg, setCurrentMsg] = useState("Buscando imóveis...");
  const [log, setLog] = useState<ReprocessLogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const { data: projects, error } = await supabase
        .from("projects")
        .select("id, name, description")
        .order("name");
      if (error) {
        if (!cancelled) {
          toast.error(error.message);
          setRunning(false);
        }
        return;
      }

      for (const p of (projects ?? []) as { id: string; name: string; description: string | null }[]) {
        if (cancelled) return;
        setCurrentMsg(`Lendo tabelas: ${p.name}...`);
        try {
          const { data: files } = await supabase.storage
            .from("project-docs")
            .list(`${p.id}/tabela`, { limit: 20 });

          if (!files || files.length === 0) {
            setLog((prev) => [...prev, { projectName: p.name, status: "sem-tabela" }]);
            continue;
          }

          const rawUnits: RawUnit[] = [];
          for (const f of files) {
            const path = `${p.id}/tabela/${f.name}`;
            const { data: blob, error: dlError } = await supabase.storage
              .from("project-docs")
              .download(path);
            if (dlError || !blob) continue;
            const file = new File([blob], f.name, { type: "application/pdf" });
            const text = await extractPDFText(file);
            const units = await extractRawUnitsFromGemini(text, p.name);
            rawUnits.push(...units);
            await sleep(3000);
          }

          if (rawUnits.length === 0) {
            setLog((prev) => [...prev, { projectName: p.name, status: "erro", detail: "Nenhuma unidade extraída" }]);
            continue;
          }

          const currentDesc: Record<string, any> = p.description ? JSON.parse(p.description) : {};
          const typologies = selectTypologiesFromUnits(rawUnits, currentDesc.typologies ?? []);

          const { error: updError } = await supabase
            .from("projects")
            .update({ description: JSON.stringify({ ...currentDesc, typologies }) })
            .eq("id", p.id);
          if (updError) throw updError;

          setLog((prev) => [...prev, { projectName: p.name, status: "ok", detail: `${typologies.length} tipologia(s)` }]);
        } catch (err: any) {
          setLog((prev) => [...prev, { projectName: p.name, status: "erro", detail: err.message }]);
        }
      }

      if (!cancelled) {
        setRunning(false);
        setCurrentMsg("Concluído");
        onDone();
      }
    };

    run();
    return () => { cancelled = true; };
  }, []);

  const okCount = log.filter((l) => l.status === "ok").length;
  const errorCount = log.filter((l) => l.status === "erro").length;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex flex-col" onClick={running ? undefined : onClose}>
      <div
        className="bg-white mt-auto rounded-t-2xl flex flex-col"
        style={{ maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border flex-shrink-0">
          <div>
            <h3 className="font-semibold text-[var(--navy)] flex items-center gap-2">
              <RefreshCw size={18} className={`text-[var(--gold)] ${running ? "animate-spin" : ""}`} />
              Reprocessar Tipologias
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {running ? currentMsg : `${okCount} atualizado(s), ${errorCount} com erro`}
            </p>
          </div>
          {!running && (
            <button onClick={onClose} className="p-1 text-muted-foreground"><X size={18} /></button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1.5">
          {log.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 size={16} className="animate-spin" /> {currentMsg}
            </div>
          )}
          {log.map((l, i) => (
            <div
              key={i}
              className={`text-xs py-2 px-3 rounded-lg ${
                l.status === "ok" ? "bg-green-50 text-green-700"
                  : l.status === "sem-tabela" ? "bg-[var(--surface)] text-muted-foreground"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {l.status === "erro" ? (
                <div className="space-y-0.5">
                  <p className="font-medium">{l.projectName}</p>
                  <p className="break-words opacity-90">{l.detail ?? "erro"}</p>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{l.projectName}</span>
                  <span className="flex-shrink-0 ml-2">
                    {l.status === "ok" ? l.detail : "sem tabela"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 pt-3 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            disabled={running}
            className="w-full h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50"
          >
            {running ? "Processando..." : "Fechar"}
          </button>
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
        extractFromGemini(text),
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

/** Status a partir do texto de entrega já salvo ("PRONTO", "Breve Lançamento", "ago-26", "Em obras"). */
function statusFromEntrega(entrega?: string): string | undefined {
  if (!entrega?.trim()) return undefined;
  const e = entrega.toLowerCase();
  if (e.includes("pronto")) return "PRONTO";
  if (e.includes("lançamento") || e.includes("lancamento")) return "LANCAMENTO";
  return "EM_OBRAS";
}

const STATUS_OPTIONS = [
  { value: "LANCAMENTO", label: "Lançamento" },
  { value: "EM_OBRAS", label: "Em Obras" },
  { value: "PRONTO", label: "Pronto" },
] as const;

const PARSE_PROPERTY_PROMPT = `Você é um assistente especialista em extrair dados de blocos de texto sobre imóveis.
Retorne APENAS um objeto JSON válido, sem markdown, sem explicações.

Estrutura obrigatória:
{
  "title": "nome do empreendimento",
  "address": "endereço completo",
  "features": ["característica 1", "característica 2"],
  "typologies": [
    {
      "name": "nome da tipologia",
      "valor": número_ou_null,
      "area": número_ou_null,
      "dormitorios": número_ou_null,
      "suites": número_ou_null,
      "vagas": número_ou_null
    }
  ]
}

Regras:
- Retorne SOMENTE o JSON puro, sem nada antes ou depois
- Campos numéricos ausentes: use null
- "features": itens listados como características/diferenciais do condomínio
- "typologies": tipos de unidade (Garden, Apartamento, Studio, etc.)
- "valor": apenas o número sem R$ ou pontos de milhar`;

type ParsedProperty = {
  title?: string;
  address?: string;
  features?: string[];
  typologies?: {
    name?: string;
    valor?: number | string | null;
    area?: number | string | null;
    dormitorios?: number | string | null;
    suites?: number | string | null;
    vagas?: number | string | null;
  }[];
};

/** Reduz a foto antes do envio (lado maior até 1920 px, JPEG). */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Campo de valor em reais (digita só números; mostra R$ 0,00). */
function CurrencyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      className={INPUT}
      inputMode="numeric"
      value={value ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : ""}
      placeholder="R$ 0,00"
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) / 100)}
    />
  );
}

// foto já salva (caminho no storage) ou escolhida agora (arquivo ainda não enviado)
type FormImage = { path?: string; file?: File; preview: string };
type FormTypology = Typology & { plantaFile?: File; plantaPreview?: string };

/**
 * Cadastro/edição de imóvel no mesmo formato do Real Sales: informações
 * gerais, tipologias (com planta) e galeria de imagens com capa, além de
 * "Importar de Texto" (a IA lê um bloco colado e preenche o formulário).
 */
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
  const [propertyType, setPropertyType] = useState(rich?.propertyType ?? "Apartamento");
  const [address, setAddress] = useState(project?.address ?? "");
  // a cidade já vem no endereço; mantém a do cadastro (ou São Paulo) sem campo próprio
  const [city] = useState(project?.city ?? "São Paulo");
  // Status e previsão de entrega são uma informação só (rich.entrega é o que
  // os cards e a ficha mostram); imóveis antigos só têm o texto de entrega.
  const [status, setStatus] = useState<string>(statusFromEntrega(rich?.entrega) ?? rich?.status ?? "LANCAMENTO");
  const [featuresText, setFeaturesText] = useState((rich?.amenities ?? []).join(", "));
  const [typologies, setTypologies] = useState<FormTypology[]>(rich?.typologies ?? []);
  const [images, setImages] = useState<FormImage[]>([]);
  // a galeria de imagens ainda não está na tela; por enquanto só a foto de capa
  // da ficha. Sem alteração, as fotos salvas ficam como estão.
  const [imagesTouched, setImagesTouched] = useState(false);
  // campos próprios deste sistema (fichas, plantão)
  // previsão (ex: ago-26): só faz sentido para imóvel em obras
  const [entrega, setEntrega] = useState(
    statusFromEntrega(rich?.entrega) === "EM_OBRAS" && !/obra/i.test(rich?.entrega ?? "") ? (rich?.entrega ?? "") : "",
  );
  const [diferencial, setDiferencial] = useState(rich?.diferencial ?? "");
  const [estrutura, setEstrutura] = useState(rich?.estrutura ?? "");
  const [distances, setDistances] = useState<DistanceItem[]>(rich?.distances ?? []);
  const [active, setActive] = useState(project?.is_active ?? true);
  const [temPlantao, setTemPlantao] = useState(project?.tem_plantao ?? false);

  // importar de texto
  const [importOpen, setImportOpen] = useState(false);
  const [textToParse, setTextToParse] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedProperty | null>(null);

  // fotos e plantas já salvas: busca os links para mostrar
  const savedPaths = [
    ...(rich?.images ?? (rich?.coverImagePath ? [rich.coverImagePath] : [])),
    ...((rich?.typologies ?? []).map((t) => t.plantaPath).filter(Boolean) as string[]),
  ];
  const savedQ = useQuery({
    queryKey: ["project-form-images", project?.id, savedPaths.join("|")],
    enabled: savedPaths.length > 0,
    queryFn: async () => {
      const { data } = await supabase.storage.from("project-docs").createSignedUrls(savedPaths, 3600);
      const map: Record<string, string> = {};
      (data ?? []).forEach((d) => {
        if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
      });
      return map;
    },
  });
  useEffect(() => {
    if (!savedQ.data) return;
    const urls = savedQ.data;
    const gallery = rich?.images ?? (rich?.coverImagePath ? [rich.coverImagePath] : []);
    setImages((prev) =>
      prev.length > 0 ? prev : gallery.filter((p) => urls[p]).map((p) => ({ path: p, preview: urls[p] })),
    );
    setTypologies((prev) =>
      prev.map((t) =>
        t.plantaPath && !t.plantaPreview && urls[t.plantaPath] ? { ...t, plantaPreview: urls[t.plantaPath] } : t,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedQ.data]);

  const addTypology = () => setTypologies((prev) => [...prev, { type: "", area: 0, vagas: 0 }]);
  const updateTypology = (i: number, patch: Partial<FormTypology>) =>
    setTypologies((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const removeTypology = (i: number) => setTypologies((prev) => prev.filter((_, idx) => idx !== i));

  const addDistance = () => setDistances((prev) => [...prev, { mode: "carro", label: "", minutes: 0 }]);
  const updateDistance = (i: number, field: keyof DistanceItem, value: any) =>
    setDistances((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  const removeDistance = (i: number) => setDistances((prev) => prev.filter((_, idx) => idx !== i));

  const handleImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const compressed = await Promise.all(files.map(compressImage));
    // foto de capa da ficha: a nova substitui a atual
    setImagesTouched(true);
    setImages((prev) => [
      ...compressed.slice(0, 1).map((file) => ({ file, preview: URL.createObjectURL(file) })),
      ...prev.slice(1),
    ]);
  };

  const handlePlanta = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw) return;
    const file = await compressImage(raw);
    updateTypology(i, { plantaFile: file, plantaPreview: URL.createObjectURL(file) });
  };

  const parseText = async () => {
    if (!textToParse.trim()) return toast.error("Cole algum texto.");
    setParsing(true);
    try {
      if (!aiConfigured()) throw new Error("Nenhuma IA configurada (VITE_GROQ_API_KEY).");
      const res = await fetchGemini("", PARSE_PROPERTY_PROMPT, textToParse);
      if (!res.ok) throw new Error(await geminiErrorMessage(res));
      setParsed(parseGeminiJson(await res.json()) as ParsedProperty);
      setImportOpen(false);
      setTextToParse("");
    } catch (err: any) {
      toast.error(err.message || "Não foi possível analisar os dados.");
    } finally {
      setParsing(false);
    }
  };

  const fillFromParsed = () => {
    if (!parsed) return;
    const num = (v: unknown) => Number(v) || 0;
    if (parsed.title) setName(parsed.title);
    if (parsed.address) setAddress(parsed.address);
    if (parsed.features?.length) setFeaturesText(parsed.features.join(", "));
    if (Array.isArray(parsed.typologies))
      setTypologies(
        parsed.typologies.map((t) => ({
          type: t.name || "",
          valor_cheio: num(t.valor) || undefined,
          area: num(t.area),
          dorms: num(t.dormitorios) || undefined,
          suites: num(t.suites) || undefined,
          vagas: num(t.vagas),
        })),
      );
    setParsed(null);
    toast.success("Formulário preenchido com os dados importados.");
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("O título do imóvel é obrigatório.");
      const base = {
        name: name.trim(),
        address: address.trim(),
        city: city.trim() || "São Paulo",
        is_active: active,
        tem_plantao: temPlantao,
        manager_id: managerId,
      };

      // 1. o imóvel precisa existir para as fotos terem onde ficar
      let id = project?.id;
      if (!id) {
        const { data, error } = await supabase
          .from("projects")
          .insert({ ...base, description: "{}" })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }

      const upload = async (folder: string, file: File) => {
        const path = `${id}/${folder}/${Date.now()}-${sanitizeStorageKey(file.name)}`;
        const { error } = await supabase.storage.from("project-docs").upload(path, file, { upsert: true });
        if (error) throw new Error(`Falha ao enviar ${file.name}: ${error.message}`);
        return path;
      };

      // 2. fotos (a primeira é a capa) e plantas
      const previousImages = rich?.images ?? (rich?.coverImagePath ? [rich.coverImagePath] : []);
      const imagePaths: string[] = imagesTouched ? [] : previousImages;
      if (imagesTouched)
        for (const img of images) imagePaths.push(img.path ?? (await upload("fotos", img.file!)));
      const savedTypologies: Typology[] = [];
      for (const t of typologies.filter((x) => x.type.trim())) {
        const { plantaFile, plantaPreview: _p, ...rest } = t;
        savedTypologies.push({
          ...rest,
          plantaPath: plantaFile ? await upload("plantas", plantaFile) : rest.plantaPath,
        });
      }

      // 3. fotos removidas saem do storage
      const removed = imagesTouched ? previousImages.filter((p) => !imagePaths.includes(p)) : [];
      if (removed.length) await supabase.storage.from("project-docs").remove(removed);

      const desc: RichDesc = {
        neighborhood: rich?.neighborhood,
        propertyType: propertyType.trim() || undefined,
        status,
        entrega:
          status === "PRONTO"
            ? "PRONTO"
            : status === "LANCAMENTO"
              ? "Breve Lançamento"
              : entrega.trim() || "Em obras",
        diferencial: diferencial || undefined,
        estrutura: estrutura || undefined,
        typologies: savedTypologies,
        images: imagePaths,
        coverImagePath: imagePaths[0],
        amenities: featuresText
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        distances: distances.filter((d) => d.label.trim()),
      };
      const { error } = await supabase
        .from("projects")
        .update({ ...base, description: JSON.stringify(desc) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects-all"] });
      qc.invalidateQueries({ queryKey: ["projects-active"] });
      qc.invalidateQueries({ queryKey: ["projects-for-dashboard"] });
      qc.invalidateQueries({ queryKey: ["project-cover"] });
      toast.success(project ? "Imóvel atualizado." : "Imóvel cadastrado com sucesso.");
      onClose();
    },
    onError: (e: any) => {
      // o imóvel pode ter sido criado antes de uma foto falhar: atualiza a lista
      qc.invalidateQueries({ queryKey: ["projects-all"] });
      toast.error(e.message);
    },
  });

  const LABEL = "text-xs font-medium text-[var(--navy)] mb-1 block";
  const CARD = "bg-white rounded-2xl border border-border p-4 space-y-4";
  const numberField = (value: number | undefined, onChange: (v: number | undefined) => void, integer = false) => (
    <input
      type="number"
      className={INPUT}
      value={value || ""}
      onChange={(e) => {
        const v = integer ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
        onChange(Number.isNaN(v) ? undefined : v);
      }}
    />
  );

  return (
    <div className="fixed inset-0 z-50 bg-[var(--surface)] overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5 pb-24">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="h-10 w-10 rounded-xl bg-white border border-border flex items-center justify-center text-[var(--navy)]"
              aria-label="Voltar"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[var(--navy)]">{project ? "Editar Imóvel" : "Novo Imóvel"}</h1>
              <p className="text-sm text-muted-foreground">
                {project
                  ? "Atualize os dados do empreendimento."
                  : "Preencha os dados para cadastrar um novo empreendimento."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setImportOpen(true)}
              className="h-10 px-4 rounded-xl bg-white border border-border text-sm font-semibold text-[var(--navy)] inline-flex items-center gap-2"
            >
              <ClipboardPaste size={16} /> Importar de Texto
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="h-10 px-4 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {save.isPending ? "Salvando..." : "Salvar Imóvel"}
            </button>
          </div>
        </div>

        <div>
          <div className="space-y-5">
            <section className={CARD}>
              <h2 className="font-bold text-[var(--navy)]">Informações Gerais</h2>
              <div>
                <label className={LABEL}>Título do Empreendimento</label>
                <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Tipo</label>
                  <input className={INPUT} value={propertyType} onChange={(e) => setPropertyType(e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>Endereço</label>
                  <input className={INPUT} value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={LABEL}>Características Condominiais (separadas por vírgula)</label>
                <textarea
                  className="w-full rounded-lg bg-[var(--surface)] border border-border text-sm p-3 min-h-20"
                  placeholder="Brinquedoteca, Churrasqueira, Elevador social..."
                  value={featuresText}
                  onChange={(e) => setFeaturesText(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Status</label>
                  <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {status === "EM_OBRAS" && (
                  <div>
                    <label className={LABEL}>Previsão de entrega (ex: ago-26)</label>
                    <input className={INPUT} value={entrega} onChange={(e) => setEntrega(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Diferencial (ex: 60m do Metrô)</label>
                  <input className={INPUT} value={diferencial} onChange={(e) => setDiferencial(e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>Estrutura de atendimento</label>
                  <input className={INPUT} value={estrutura} onChange={(e) => setEstrutura(e.target.value)} />
                </div>
              </div>
              <div>
                <label className={LABEL}>Foto de capa (ficha)</label>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-20 rounded-xl border border-border bg-[var(--surface)] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {images[0] ? (
                      <img src={images[0].preview} alt="Capa" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon size={22} className="text-muted-foreground/40" />
                    )}
                  </div>
                  <label className="h-10 px-3 rounded-lg bg-[var(--surface)] border border-border text-sm font-medium text-[var(--navy)] inline-flex items-center gap-2 cursor-pointer">
                    <Upload size={14} /> {images[0] ? "Trocar foto" : "Enviar foto"}
                    <input type="file" accept="image/*" className="hidden" onChange={handleImages} />
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={LABEL}>Distâncias</label>
                  <button
                    onClick={addDistance}
                    className="text-xs font-semibold text-[var(--navy)] flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--surface)] border border-border"
                  >
                    <Plus size={12} /> Adicionar
                  </button>
                </div>
                {distances.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      className="h-10 px-2 rounded-lg bg-[var(--surface)] border border-border text-sm flex-shrink-0"
                      value={d.mode}
                      onChange={(e) => updateDistance(i, "mode", e.target.value as DistanceMode)}
                    >
                      <option value="carro">Carro</option>
                      <option value="pe">A pé</option>
                      <option value="bike">Bike</option>
                    </select>
                    <input
                      className={`${INPUT} flex-1`}
                      placeholder="Ex: Shopping Bourbon"
                      value={d.label}
                      onChange={(e) => updateDistance(i, "label", e.target.value)}
                    />
                    <input
                      type="number"
                      className="w-16 h-10 px-2 rounded-lg bg-[var(--surface)] border border-border text-sm flex-shrink-0"
                      placeholder="min"
                      value={d.minutes || ""}
                      onChange={(e) => updateDistance(i, "minutes", parseInt(e.target.value) || 0)}
                    />
                    <button onClick={() => removeDistance(i)} className="p-1.5 text-red-400 hover:text-red-600 flex-shrink-0">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border cursor-pointer">
                  <span className="text-sm font-medium text-[var(--navy)]">Ativo</span>
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-5 h-5 accent-[var(--gold)] cursor-pointer" />
                </label>
                <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border cursor-pointer">
                  <span className="text-sm font-medium text-[var(--navy)]">Tem Plantão</span>
                  <input type="checkbox" checked={temPlantao} onChange={(e) => setTemPlantao(e.target.checked)} className="w-5 h-5 accent-[var(--gold)] cursor-pointer" />
                </label>
              </div>
            </section>

            <section className={CARD}>
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-[var(--navy)]">Tipologias</h2>
                <button
                  onClick={addTypology}
                  className="h-9 px-3 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus size={15} /> Adicionar
                </button>
              </div>
              {typologies.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  Nenhuma tipologia. Clique em Adicionar.
                </p>
              )}
              {typologies.map((t, i) => (
                <div key={i} className="p-4 border border-border rounded-xl space-y-4 relative">
                  <button
                    onClick={() => removeTypology(i)}
                    className="absolute top-2 right-2 p-1.5 text-muted-foreground hover:text-red-600"
                    aria-label="Remover tipologia"
                  >
                    <Trash2 size={16} />
                  </button>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pr-8 md:pr-0">
                    <div>
                      <label className={LABEL}>Nome</label>
                      <input className={INPUT} value={t.type} onChange={(e) => updateTypology(i, { type: e.target.value })} />
                    </div>
                    <div>
                      <label className={LABEL}>Valor</label>
                      <CurrencyInput
                        value={t.valor_cheio ?? 0}
                        onChange={(v) => updateTypology(i, { valor_cheio: v || undefined })}
                      />
                    </div>
                    <div>
                      <label className={LABEL}>Área (m²)</label>
                      {numberField(t.area, (v) => updateTypology(i, { area: v ?? 0 }))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className={LABEL}>Dorms</label>
                      {numberField(t.dorms, (v) => updateTypology(i, { dorms: v }), true)}
                    </div>
                    <div>
                      <label className={LABEL}>Suítes</label>
                      {numberField(t.suites, (v) => updateTypology(i, { suites: v }), true)}
                    </div>
                    <div>
                      <label className={LABEL}>Vagas</label>
                      {numberField(t.vagas, (v) => updateTypology(i, { vagas: v ?? 0 }), true)}
                    </div>
                  </div>
                  <div>
                    <label className={LABEL}>Planta da Tipologia (Opcional)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handlePlanta(i, e)}
                      className="block w-full text-sm text-muted-foreground file:mr-3 file:h-9 file:px-3 file:rounded-lg file:border file:border-border file:bg-[var(--surface)] file:text-sm file:font-medium file:text-[var(--navy)]"
                    />
                    {t.plantaPreview && (
                      <img
                        src={t.plantaPreview}
                        alt={`Planta de ${t.type || "tipologia"}`}
                        className="mt-2 h-24 w-auto rounded-md border border-border"
                      />
                    )}
                  </div>
                </div>
              ))}
            </section>

          </div>

        </div>
      </div>

      {importOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setImportOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-[var(--navy)] text-lg">Importar Imóvel de Texto</h3>
              <p className="text-sm text-muted-foreground">Copie todo o bloco de informações do imóvel e cole abaixo.</p>
            </div>
            <textarea
              value={textToParse}
              onChange={(e) => setTextToParse(e.target.value)}
              className="w-full h-48 rounded-lg bg-[var(--surface)] border border-border text-sm font-mono p-3"
              placeholder="Cole o texto do imóvel aqui..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setImportOpen(false)} className="h-10 px-4 rounded-xl bg-[var(--surface)] text-sm font-medium text-[var(--navy)]">
                Cancelar
              </button>
              <button
                onClick={parseText}
                disabled={parsing}
                className="h-10 px-4 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                {parsing && <Loader2 size={16} className="animate-spin" />}
                {parsing ? "Analisando..." : "Analisar e Importar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {parsed && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setParsed(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-[var(--navy)] text-lg">Confirmar Dados Importados</h3>
              <p className="text-sm text-muted-foreground">Verifique os dados extraídos antes de preencher o formulário.</p>
            </div>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              <div>
                <h4 className="font-semibold text-sm text-[var(--navy)]">Título</h4>
                <p className="text-sm text-muted-foreground p-2 bg-[var(--surface)] rounded-md">{parsed.title || "Não encontrado"}</p>
              </div>
              <div>
                <h4 className="font-semibold text-sm text-[var(--navy)]">Endereço</h4>
                <p className="text-sm text-muted-foreground p-2 bg-[var(--surface)] rounded-md">{parsed.address || "Não encontrado"}</p>
              </div>
              <div>
                <h4 className="font-semibold text-sm text-[var(--navy)]">
                  Características Encontradas ({parsed.features?.length ?? 0})
                </h4>
                <div className="flex flex-wrap gap-2 p-2 bg-[var(--surface)] rounded-md">
                  {(parsed.features ?? []).map((f, i) => (
                    <span key={i} className="text-xs bg-white border border-border rounded-full px-2 py-0.5">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-sm text-[var(--navy)] mb-2">
                  Tipologias Encontradas ({parsed.typologies?.length ?? 0})
                </h4>
                <div className="space-y-2">
                  {(parsed.typologies ?? []).map((t, i) => (
                    <div key={i} className="text-xs text-muted-foreground p-2 border border-border rounded-md">
                      <p className="font-bold text-[var(--navy)]">{t.name}</p>
                      <p>
                        Área: {t.area || "N/A"} m² | Dorms: {t.dormitorios || "N/A"} | Suítes: {t.suites || "N/A"} | Vagas:{" "}
                        {t.vagas || "N/A"}
                      </p>
                      <p>Valor: {fmtBRL(Number(t.valor) || 0)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setParsed(null)} className="h-10 px-4 rounded-xl bg-[var(--surface)] text-sm font-medium text-[var(--navy)]">
                Cancelar
              </button>
              <button onClick={fillFromParsed} className="h-10 px-4 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold">
                Preencher Formulário
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
