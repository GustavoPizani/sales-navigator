import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileText, ImageUp, Loader2, Pencil, Search, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeitorPdf } from "@/components/treinamentos/LeitorPdf";
import { useAuth } from "@/hooks/useAuth";
import {
  BUCKET_PDF,
  CATEGORIA_LABEL,
  PUBLICO_LABEL,
  db,
  lerPdf,
  produtoDoArquivo,
  tituloDoArquivo,
  useMateriais,
  useProdutos,
  type Categoria,
  type Material,
  type Publico,
} from "@/lib/treinamentos";

// Biblioteca dos Treinamentos (como a do Conx Academy): PDFs de treinamento de
// produto e livros, com capa da primeira página e leitor dentro do app.

const campoCls = "h-10 px-3 rounded-lg bg-[var(--surface)] border border-border text-sm";
const inputCls = `w-full ${campoCls}`;
const rotuloCls = "text-[11px] font-semibold text-muted-foreground uppercase block mb-0.5";
const MAX_PDF = 50 * 1024 * 1024;
const MAX_CAPA = 5 * 1024 * 1024;

type ComCapa = Material & { capa: string | null };

export function Biblioteca() {
  const { isSuperAdmin } = useAuth();
  const matQ = useMateriais();
  const [categoria, setCategoria] = useState<Categoria>("treinamento");
  const [produto, setProduto] = useState("");
  const [busca, setBusca] = useState("");
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [lendo, setLendo] = useState<{ m: ComCapa; url: string } | null>(null);
  const [editando, setEditando] = useState<ComCapa | null>(null);
  const [enviando, setEnviando] = useState<File[] | null>(null);

  const todos = matQ.data ?? [];
  const daCategoria = todos.filter((m) => m.category === categoria);
  const produtos = useMemo(
    () => [...new Set(daCategoria.flatMap((m) => (m.product_name ? [m.product_name] : [])))].sort(),
    [daCategoria],
  );
  const chave = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lista = daCategoria.filter(
    (m) =>
      (!produto || m.product_name === produto) &&
      (!busca.trim() || chave(`${m.title} ${m.product_name ?? ""}`).includes(chave(busca.trim()))),
  );

  // materiais que entraram sem capa ou sem o número de páginas (leitura do PDF falhou no envio)
  const qc = useQueryClient();
  const semCapa = isSuperAdmin ? todos.filter((m) => !m.cover_path || !m.pages) : [];
  const [geradas, setGeradas] = useState(0);
  const gerarCapas = useMutation({
    mutationFn: async () => {
      setGeradas(0);
      let falhas = 0;
      for (const m of semCapa) {
        const { data, error } = await db.storage.from(BUCKET_PDF).download(m.pdf_path);
        if (error) {
          falhas++;
          continue;
        }
        const { capa, paginas } = await lerPdf(
          new File([data], "material.pdf", { type: "application/pdf" }),
        );
        if (!capa && !paginas) {
          falhas++;
          continue;
        }
        let coverPath = m.cover_path;
        if (!coverPath && capa) {
          const caminho = `materiais/${m.id}.jpg`;
          const up = await db.storage
            .from(BUCKET_PDF)
            .upload(caminho, capa, { contentType: "image/jpeg", upsert: true });
          if (!up.error) coverPath = caminho;
        }
        const { error: e2 } = await db
          .from("training_materials")
          .update({ cover_path: coverPath, pages: paginas ?? m.pages })
          .eq("id", m.id);
        if (e2) falhas++;
        setGeradas((n) => n + 1);
      }
      if (falhas)
        throw new Error(
          `${falhas} material(is) não puderam ser lidos. Recarregue a página e tente de novo.`,
        );
    },
    onSuccess: () => toast.success("Capas geradas"),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["treinamentos", "materiais"] }),
  });

  const abrir = async (m: ComCapa) => {
    setAbrindo(m.id);
    try {
      const { data, error } = await db.storage.from(BUCKET_PDF).createSignedUrl(m.pdf_path, 3600);
      if (error) throw error;
      setLendo({ m, url: data.signedUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o PDF.");
    } finally {
      setAbrindo(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <div
          className="inline-flex rounded-lg bg-[var(--surface)] p-1"
          role="tablist"
          aria-label="Tipo de material"
        >
          {(Object.keys(CATEGORIA_LABEL) as Categoria[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={categoria === k}
              onClick={() => {
                setCategoria(k);
                setProduto("");
              }}
              className={`h-9 px-3 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${categoria === k ? "bg-[var(--navy)] text-white" : "text-muted-foreground"}`}
            >
              {k === "treinamento" ? (
                <FileText size={15} aria-hidden />
              ) : (
                <BookOpen size={15} aria-hidden />
              )}
              {CATEGORIA_LABEL[k]}
            </button>
          ))}
        </div>
        {produtos.length > 1 && (
          <select
            className={campoCls}
            value={produto}
            onChange={(e) => setProduto(e.target.value)}
            aria-label="Produto"
          >
            <option value="">Todos os produtos</option>
            {produtos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <label className="relative flex-1 min-w-[10rem] max-w-xs">
          <span className="sr-only">Buscar</span>
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Buscar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        {isSuperAdmin && (
          <label className="ml-auto h-10 px-4 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer">
            <Upload size={16} aria-hidden /> Enviar PDFs
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="sr-only"
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])];
                e.target.value = "";
                if (fs.length) setEnviando(fs);
              }}
            />
          </label>
        )}
      </div>

      {semCapa.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="flex-1 min-w-[12rem]">
            {semCapa.length} material{semCapa.length === 1 ? "" : "is"} sem capa ou sem o número de
            páginas.
          </span>
          <button
            type="button"
            onClick={() => gerarCapas.mutate()}
            disabled={gerarCapas.isPending}
            className="h-9 px-3 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {gerarCapas.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {gerarCapas.isPending
              ? `Gerando ${geradas} de ${semCapa.length}…`
              : "Gerar pela primeira página"}
          </button>
        </div>
      )}

      {matQ.isPending && (
        <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
      )}
      {matQ.isError && (
        <p className="text-sm text-red-600 py-6 text-center">
          {/training_materials/.test((matQ.error as Error).message)
            ? "A biblioteca ainda não foi ativada no banco: rode a migration 20261029000002_treinamentos_biblioteca.sql."
            : (matQ.error as Error).message}
        </p>
      )}
      {!matQ.isPending && !matQ.isError && lista.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          <BookOpen size={40} className="mx-auto mb-3 opacity-40" aria-hidden />
          <p className="text-sm">
            {busca || produto
              ? "Nada encontrado com esse filtro."
              : isSuperAdmin
                ? "Nenhum material ainda. Envie os PDFs em “Enviar PDFs”."
                : "Nenhum material disponível por enquanto."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {lista.map((m) => (
          <article key={m.id} className="group relative">
            <button
              type="button"
              onClick={() => abrir(m)}
              className="block w-full text-left"
              aria-label={`Abrir ${m.title}`}
            >
              <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-[var(--navy)] border border-border shadow-sm transition-transform group-hover:scale-[1.02]">
                {m.capa ? (
                  <img
                    src={m.capa}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover object-top bg-white"
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center">
                    <FileText size={40} className="text-white/30" aria-hidden />
                  </span>
                )}
                {abrindo === m.id && (
                  <span className="absolute inset-0 grid place-items-center bg-black/40">
                    <Loader2 size={28} className="animate-spin text-white" aria-hidden />
                  </span>
                )}
                {isSuperAdmin && !m.published && (
                  <span className="absolute top-2 left-2 rounded-full bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5">
                    Rascunho
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-semibold text-[var(--navy)] leading-snug line-clamp-2">
                {m.title}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {[
                  m.product_name,
                  m.pages ? `${m.pages} pág.` : null,
                  isSuperAdmin && m.audience !== "all" ? PUBLICO_LABEL[m.audience] : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </button>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setEditando(m)}
                className="absolute top-2 right-2 h-8 w-8 grid place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
                aria-label={`Editar ${m.title}`}
              >
                <Pencil size={14} aria-hidden />
              </button>
            )}
          </article>
        ))}
      </div>

      {lendo && (
        <LeitorPdf
          id={lendo.m.id}
          titulo={lendo.m.title}
          url={lendo.url}
          onClose={() => setLendo(null)}
        />
      )}
      {editando && <EditarMaterial material={editando} onClose={() => setEditando(null)} />}
      {enviando && (
        <EnviarPdfs arquivos={enviando} categoria={categoria} onClose={() => setEnviando(null)} />
      )}
    </>
  );
}

// ─── Envio (só ADM) ─────────────────────────────────────────────────────────

type Rascunho = { arquivo: File; title: string; product_name: string; category: Categoria };

function EnviarPdfs({
  arquivos,
  categoria,
  onClose,
}: {
  arquivos: File[];
  categoria: Categoria;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const produtosQ = useProdutos();
  const produtos = produtosQ.data ?? [];
  const [audience, setAudience] = useState<Publico>("all");
  const [itens, setItens] = useState<Rascunho[] | null>(null);
  const [feitos, setFeitos] = useState(0);
  // o produto é sugerido pelo nome do arquivo quando a lista de Imóveis chega
  const lista: Rascunho[] =
    itens ??
    arquivos.map((f) => ({
      arquivo: f,
      title: tituloDoArquivo(f.name),
      product_name: categoria === "treinamento" ? (produtoDoArquivo(f.name, produtos) ?? "") : "",
      category: categoria,
    }));
  const mudar = (i: number, p: Partial<Rascunho>) =>
    setItens(lista.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const enviar = useMutation({
    mutationFn: async () => {
      for (const [i, r] of lista.entries()) {
        if (!r.title.trim()) throw new Error(`Arquivo ${i + 1}: falta o título.`);
        if (r.arquivo.size > MAX_PDF) throw new Error(`${r.arquivo.name}: passa de 50 MB.`);
      }
      setFeitos(0);
      for (const r of lista) {
        const id = crypto.randomUUID();
        const pdfPath = `materiais/${id}.pdf`;
        const { capa, paginas } = await lerPdf(r.arquivo);
        const up = await db.storage
          .from(BUCKET_PDF)
          .upload(pdfPath, r.arquivo, { contentType: "application/pdf" });
        if (up.error) throw new Error(`${r.arquivo.name}: ${up.error.message}`);
        let coverPath: string | null = null;
        if (capa) {
          coverPath = `materiais/${id}.jpg`;
          const c = await db.storage
            .from(BUCKET_PDF)
            .upload(coverPath, capa, { contentType: "image/jpeg" });
          if (c.error) coverPath = null;
        }
        const { error } = await db.from("training_materials").insert({
          id,
          title: r.title.trim(),
          category: r.category,
          product_name: r.category === "treinamento" ? r.product_name || null : null,
          pdf_path: pdfPath,
          cover_path: coverPath,
          pages: paginas,
          audience,
          published: true,
          created_by: user?.id,
        });
        if (error) {
          await db.storage.from(BUCKET_PDF).remove([pdfPath, ...(coverPath ? [coverPath] : [])]);
          throw new Error(`${r.arquivo.name}: ${error.message}`);
        }
        setFeitos((n) => n + 1);
      }
    },
    onSuccess: async () => {
      toast.success(lista.length === 1 ? "PDF enviado" : `${lista.length} PDFs enviados`);
      await qc.invalidateQueries({ queryKey: ["treinamentos", "materiais"] });
      onClose();
    },
    onError: async (e: Error) => {
      toast.error(e.message);
      await qc.invalidateQueries({ queryKey: ["treinamentos", "materiais"] });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !enviar.isPending && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar {lista.length === 1 ? "PDF" : `${lista.length} PDFs`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <ul className="space-y-2">
            {lista.map((r, i) => (
              <li key={i} className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-xs text-muted-foreground truncate">
                  {r.arquivo.name} · {(r.arquivo.size / 1048576).toFixed(1)} MB
                </p>
                <input
                  className={inputCls}
                  value={r.title}
                  onChange={(e) => mudar(i, { title: e.target.value })}
                  aria-label={`Título de ${r.arquivo.name}`}
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    className={campoCls}
                    value={r.category}
                    onChange={(e) => mudar(i, { category: e.target.value as Categoria })}
                    aria-label={`Tipo de ${r.arquivo.name}`}
                  >
                    <option value="treinamento">Treinamento</option>
                    <option value="livro">Livro</option>
                  </select>
                  {r.category === "treinamento" && (
                    <select
                      className={`${campoCls} flex-1 min-w-[12rem]`}
                      value={r.product_name}
                      onChange={(e) => mudar(i, { product_name: e.target.value })}
                      aria-label={`Produto de ${r.arquivo.name}`}
                    >
                      <option value="">Sem produto</option>
                      {produtos.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <label className="block">
            <span className={rotuloCls}>Para quem</span>
            <select
              className={campoCls}
              value={audience}
              onChange={(e) => setAudience(e.target.value as Publico)}
            >
              {(Object.keys(PUBLICO_LABEL) as Publico[]).map((k) => (
                <option key={k} value={k}>
                  {PUBLICO_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-end gap-3 pt-1">
            {enviar.isPending && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {feitos} de {lista.length} enviados…
              </span>
            )}
            <button
              type="button"
              onClick={() => enviar.mutate()}
              disabled={enviar.isPending}
              className="h-10 px-5 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {enviar.isPending ? (
                <Loader2 size={15} className="animate-spin" aria-hidden />
              ) : (
                <Upload size={15} aria-hidden />
              )}
              Enviar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edição (só ADM) ────────────────────────────────────────────────────────

function EditarMaterial({ material, onClose }: { material: ComCapa; onClose: () => void }) {
  const qc = useQueryClient();
  const produtosQ = useProdutos();
  const [title, setTitle] = useState(material.title);
  const [description, setDescription] = useState(material.description ?? "");
  const [category, setCategory] = useState<Categoria>(material.category);
  const [product, setProduct] = useState(material.product_name ?? "");
  const [audience, setAudience] = useState<Publico>(material.audience);
  const [published, setPublished] = useState(material.published);
  // capa: "manter", uma imagem enviada pelo ADM ou de novo a primeira página do PDF
  const [capa, setCapa] = useState<
    { tipo: "manter" } | { tipo: "arquivo"; arquivo: File; previa: string } | { tipo: "pdf" }
  >({
    tipo: "manter",
  });
  const previa =
    capa.tipo === "arquivo" ? capa.previa : capa.tipo === "manter" ? material.capa : null;

  const salvar = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Dê um título ao material.");
      let coverPath = material.cover_path;
      if (capa.tipo !== "manter") {
        let blob: Blob | null = null;
        let ext = "jpg";
        if (capa.tipo === "arquivo") {
          if (capa.arquivo.size > MAX_CAPA) throw new Error("A capa passa de 5 MB.");
          blob = capa.arquivo;
          ext =
            capa.arquivo.type === "image/png"
              ? "png"
              : capa.arquivo.type === "image/webp"
                ? "webp"
                : "jpg";
        } else {
          // de novo a primeira página do PDF
          const { data, error } = await db.storage.from(BUCKET_PDF).download(material.pdf_path);
          if (error) throw error;
          blob = (await lerPdf(new File([data], "material.pdf", { type: "application/pdf" }))).capa;
          if (!blob) throw new Error("Não foi possível gerar a capa pelo PDF.");
        }
        // nome novo a cada troca: o navegador não mostra a capa antiga guardada
        const caminho = `materiais/${material.id}-capa-${Date.now()}.${ext}`;
        const up = await db.storage
          .from(BUCKET_PDF)
          .upload(caminho, blob, { contentType: blob.type || "image/jpeg" });
        if (up.error) throw new Error(`Não foi possível enviar a capa: ${up.error.message}`);
        coverPath = caminho;
      }
      const { error } = await db
        .from("training_materials")
        .update({
          cover_path: coverPath,
          title: title.trim(),
          description: description.trim() || null,
          category,
          product_name: category === "treinamento" ? product || null : null,
          audience,
          published,
          updated_at: new Date().toISOString(),
        })
        .eq("id", material.id);
      if (error) throw error;
      if (coverPath !== material.cover_path && material.cover_path)
        await db.storage.from(BUCKET_PDF).remove([material.cover_path]);
    },
    onSuccess: async () => {
      toast.success("Material salvo");
      await qc.invalidateQueries({ queryKey: ["treinamentos", "materiais"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("training_materials").delete().eq("id", material.id);
      if (error) throw error;
      await db.storage
        .from(BUCKET_PDF)
        .remove([material.pdf_path, ...(material.cover_path ? [material.cover_path] : [])]);
    },
    onSuccess: async () => {
      toast.success("Material excluído");
      await qc.invalidateQueries({ queryKey: ["treinamentos", "materiais"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar material</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-24 shrink-0 aspect-[3/4] rounded-lg overflow-hidden bg-[var(--navy)] border border-border grid place-items-center">
              {previa ? (
                <img
                  src={previa}
                  alt="Capa"
                  className="w-full h-full object-cover object-top bg-white"
                />
              ) : (
                <FileText
                  size={28}
                  className="text-white/30"
                  aria-label={capa.tipo === "pdf" ? "Capa da primeira página" : "Sem capa"}
                />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <span className={rotuloCls}>Capa</span>
              <label className="h-9 px-3 rounded-lg border border-border text-sm inline-flex items-center gap-1.5 cursor-pointer hover:bg-[var(--surface)]">
                <ImageUp size={15} aria-hidden /> Enviar imagem
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) setCapa({ tipo: "arquivo", arquivo: f, previa: URL.createObjectURL(f) });
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setCapa({ tipo: "pdf" })}
                className="block text-xs text-muted-foreground underline"
              >
                Usar a primeira página do PDF
              </button>
              <p className="text-[11px] text-muted-foreground">
                {capa.tipo === "arquivo"
                  ? "Nova capa escolhida: vale ao salvar."
                  : capa.tipo === "pdf"
                    ? "A capa volta a ser a primeira página ao salvar."
                    : "JPG, PNG ou WEBP, até 5 MB. Formato em pé (3:4) fica melhor."}
              </p>
            </div>
          </div>
          <label className="block">
            <span className={rotuloCls}>Título</span>
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
            />
          </label>
          <label className="block">
            <span className={rotuloCls}>Descrição</span>
            <textarea
              className={`${inputCls} h-20 py-2`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={600}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <label className="block">
              <span className={rotuloCls}>Tipo</span>
              <select
                className={campoCls}
                value={category}
                onChange={(e) => setCategory(e.target.value as Categoria)}
              >
                <option value="treinamento">Treinamento</option>
                <option value="livro">Livro</option>
              </select>
            </label>
            {category === "treinamento" && (
              <label className="block flex-1 min-w-[12rem]">
                <span className={rotuloCls}>Produto</span>
                <select
                  className={inputCls}
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  <option value="">Sem produto</option>
                  {[...new Set([...(produtosQ.data ?? []), ...(product ? [product] : [])])].map(
                    (p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}
            <label className="block">
              <span className={rotuloCls}>Para quem</span>
              <select
                className={campoCls}
                value={audience}
                onChange={(e) => setAudience(e.target.value as Publico)}
              >
                {(Object.keys(PUBLICO_LABEL) as Publico[]).map((k) => (
                  <option key={k} value={k}>
                    {PUBLICO_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="h-4 w-4"
            />
            Publicado (aparece para a equipe)
          </label>
          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => confirm(`Excluir "${material.title}"?`) && excluir.mutate()}
              disabled={excluir.isPending}
              className="h-10 px-3 rounded-lg text-sm text-red-600 hover:bg-red-50"
            >
              Excluir
            </button>
            <button
              type="button"
              onClick={() => salvar.mutate()}
              disabled={salvar.isPending}
              className="h-10 px-5 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {salvar.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Salvar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
