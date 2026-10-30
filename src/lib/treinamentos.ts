import type { SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Treinamentos: cursos com aulas em vídeo (YouTube não listado), a biblioteca de
// PDFs (treinamentos de produto e livros) e o progresso de cada usuário. As
// regras de quem vê o quê ficam no banco (RLS): o conteúdo só chega a quem é do
// público dele, e o progresso dos outros só ao ADM e ao gestor.

// (as tabelas training_* ainda não estão nos tipos gerados do Supabase)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as SupabaseClient<any>;

export type Publico = "all" | "broker" | "master";
export const PUBLICO_LABEL: Record<Publico, string> = {
  all: "Todos",
  broker: "Corretores",
  master: "Gestores",
};

export type Aula = {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  youtube_id: string;
  duration_min: number | null;
  position: number;
};
export type Curso = {
  id: string;
  title: string;
  description: string | null;
  audience: Publico;
  published: boolean;
  position: number;
  training_lessons: Aula[];
};

/** Código do vídeo a partir do link do YouTube (watch, youtu.be, shorts, embed) ou do próprio código. */
export function codigoYoutube(texto: string): string | null {
  const s = texto.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(
      s,
    );
  return m ? m[1] : null;
}

export const capaDoVideo = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Cursos que o usuário pode ver (o ADM vê também os rascunhos), com as aulas em ordem. */
export function useCursos() {
  return useQuery({
    queryKey: ["treinamentos", "cursos"],
    queryFn: async (): Promise<Curso[]> => {
      const { data, error } = await db
        .from("training_courses")
        .select(
          "id,title,description,audience,published,position, training_lessons(id,course_id,title,description,youtube_id,duration_min,position)",
        )
        .order("position")
        .order("created_at");
      if (error) throw error;
      return ((data ?? []) as Curso[]).map((c) => ({
        ...c,
        training_lessons: [...c.training_lessons].sort((a, b) => a.position - b.position),
      }));
    },
  });
}

/** Aulas concluídas pelo usuário (ids). */
export function useMeuProgresso(userId: string | undefined) {
  return useQuery({
    queryKey: ["treinamentos", "progresso", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await db
        .from("training_progress")
        .select("lesson_id")
        .eq("user_id", userId!);
      if (error) throw error;
      return new Set((data ?? []).map((r: { lesson_id: string }) => r.lesson_id));
    },
  });
}

export const minutos = (aulas: Aula[]) => aulas.reduce((a, l) => a + (l.duration_min ?? 0), 0);

/** Texto da duração: "45 min", "1h20". */
export function duracao(min: number) {
  if (!min) return "";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

// ─── Biblioteca (PDFs) ──────────────────────────────────────────────────────

export const BUCKET_PDF = "training-docs";

export type Categoria = "treinamento" | "livro";
export const CATEGORIA_LABEL: Record<Categoria, string> = {
  treinamento: "Treinamentos",
  livro: "Livros",
};

export type Material = {
  id: string;
  title: string;
  description: string | null;
  category: Categoria;
  /** empreendimento do treinamento (nome do cadastro de Imóveis) */
  product_name: string | null;
  pdf_path: string;
  cover_path: string | null;
  pages: number | null;
  audience: Publico;
  published: boolean;
  created_at: string;
};

/** PDFs que o usuário pode ver (o ADM vê também os rascunhos), com a capa já assinada. */
export function useMateriais() {
  return useQuery({
    queryKey: ["treinamentos", "materiais"],
    queryFn: async (): Promise<(Material & { capa: string | null })[]> => {
      const { data, error } = await db
        .from("training_materials")
        .select(
          "id,title,description,category,product_name,pdf_path,cover_path,pages,audience,published,created_at",
        )
        .order("product_name", { nullsFirst: false })
        .order("title");
      if (error) throw error;
      const lista = (data ?? []) as Material[];
      const capas = lista.flatMap((m) => (m.cover_path ? [m.cover_path] : []));
      const assinadas = new Map<string, string>();
      if (capas.length) {
        const { data: urls } = await db.storage.from(BUCKET_PDF).createSignedUrls(capas, 3600);
        for (const u of urls ?? []) if (u.path && u.signedUrl) assinadas.set(u.path, u.signedUrl);
      }
      return lista.map((m) => ({
        ...m,
        capa: m.cover_path ? (assinadas.get(m.cover_path) ?? null) : null,
      }));
    },
    staleTime: 30 * 60_000,
  });
}

/** Imóveis ativos do cadastro, para ligar o treinamento ao produto. */
export function useProdutos() {
  return useQuery({
    queryKey: ["treinamentos", "produtos"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await db
        .from("projects")
        .select("name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? [])
        .map((p: { name: string }) => p.name)
        .filter((n: string) => !/^tabel[ãa]o$/i.test(n));
    },
    staleTime: 30 * 60_000,
  });
}

/** Produto do cadastro pelo nome do arquivo ("_HARMONIA _ VERSÃO..." -> "HARMONIA DA VILA"). */
export function produtoDoArquivo(nome: string, produtos: string[]): string | null {
  const chave = (s: string) =>
    s
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z0-9]/g, "");
  const arq = chave(nome);
  // a palavra mais característica do produto: "312 JAM MOEMA" -> 312JAM, "AD330 - ALTO..." -> AD330
  let melhor: string | null = null;
  let tam = 0;
  for (const p of produtos) {
    const partes = p
      .split(/\s+-\s+|\s+/)
      .map(chave)
      .filter(Boolean);
    for (let n = Math.min(2, partes.length); n >= 1; n--) {
      const k = partes.slice(0, n).join("");
      if (k.length >= 3 && arq.includes(k) && k.length > tam) {
        melhor = p;
        tam = k.length;
      }
    }
  }
  return melhor;
}

/** Título a partir do nome do arquivo: tira extensão, sublinhados e versões. */
export function tituloDoArquivo(nome: string) {
  return nome
    .replace(/\.pdf$/i, "")
    .replace(/_/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Capa (primeira página em JPEG) e número de páginas do PDF. */
export async function lerPdf(
  arquivo: File,
): Promise<{ capa: Blob | null; paginas: number | null }> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
    const doc = await pdfjsLib.getDocument({ data: await arquivo.arrayBuffer() }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 600 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const capa = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    return { capa, paginas: doc.numPages };
  } catch (e) {
    console.warn("Não foi possível gerar a capa do PDF:", e);
    return { capa: null, paginas: null };
  }
}
