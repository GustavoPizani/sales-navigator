import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  PlayCircle,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { AppHeader } from "@/components/AppHeader";
import { RequireModule } from "@/components/RequireModule";
import { Biblioteca } from "@/components/treinamentos/Biblioteca";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  PUBLICO_LABEL,
  capaDoVideo,
  codigoYoutube,
  db,
  duracao,
  minutos,
  useCursos,
  useMeuProgresso,
  type Curso,
  type Publico,
} from "@/lib/treinamentos";

export const Route = createFileRoute("/_authenticated/treinamentos")({
  component: () => (
    <RequireModule modules={["training"]}>
      <TreinamentosPage />
    </RequireModule>
  ),
});

const campoCls = "h-10 px-3 rounded-lg bg-[var(--surface)] border border-border text-sm";
const inputCls = `w-full ${campoCls}`;
const rotuloCls = "text-[11px] font-semibold text-muted-foreground uppercase block mb-0.5";

function TreinamentosPage() {
  const { isSuperAdmin } = useAuth();
  const [aba, setAba] = useState<"biblioteca" | "cursos" | "equipe">("biblioteca");
  return (
    <div className="pb-nav">
      <AppHeader title="Treinamentos" />
      <div className="px-4 pt-4 max-w-6xl mx-auto space-y-4">
        {/* os cursos em vídeo ficam só para o ADM por enquanto; a equipe vê a biblioteca */}
        {isSuperAdmin && (
          <div className="inline-flex rounded-lg bg-[var(--surface)] p-1" role="tablist">
            {(
              [
                ["biblioteca", "Biblioteca"],
                ["cursos", "Cursos em vídeo · só ADM"],
                ["equipe", "Acompanhamento"],
              ] as const
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={aba === k}
                onClick={() => setAba(k)}
                className={`h-9 px-3 rounded-md text-sm font-medium ${aba === k ? "bg-[var(--navy)] text-white" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {aba === "biblioteca" || !isSuperAdmin ? (
          <Biblioteca />
        ) : aba === "cursos" ? (
          <Cursos />
        ) : (
          <Acompanhamento />
        )}
      </div>
    </div>
  );
}

// ─── Cursos ─────────────────────────────────────────────────────────────────

function Cursos() {
  const { user, isSuperAdmin } = useAuth();
  const cursosQ = useCursos();
  const progQ = useMeuProgresso(user?.id);
  const [editando, setEditando] = useState<Curso | "novo" | null>(null);
  const feitas = progQ.data ?? new Set<string>();
  const cursos = cursosQ.data ?? [];

  return (
    <>
      {isSuperAdmin && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditando("novo")}
            className="h-10 px-4 rounded-lg bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Plus size={16} aria-hidden /> Novo curso
          </button>
        </div>
      )}

      {cursosQ.isPending && (
        <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
      )}
      {cursosQ.isError && (
        <p className="text-sm text-red-600 py-6 text-center">
          {/training_courses/.test((cursosQ.error as Error).message)
            ? "Os treinamentos ainda não foram ativados no banco: rode a migration 20261029000001_treinamentos.sql."
            : (cursosQ.error as Error).message}
        </p>
      )}
      {!cursosQ.isPending && !cursosQ.isError && cursos.length === 0 && (
        <div className="py-16 text-center text-muted-foreground">
          <GraduationCap size={40} className="mx-auto mb-3 opacity-40" aria-hidden />
          <p className="text-sm">
            {isSuperAdmin
              ? "Nenhum curso ainda. Crie o primeiro em “Novo curso”."
              : "Nenhum treinamento disponível por enquanto."}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cursos.map((c) => {
          const aulas = c.training_lessons;
          const ok = aulas.filter((a) => feitas.has(a.id)).length;
          const pct = aulas.length ? Math.round((ok / aulas.length) * 100) : 0;
          const capa = aulas[0] ? capaDoVideo(aulas[0].youtube_id) : null;
          return (
            <article
              key={c.id}
              className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col"
            >
              <Link
                to="/treinamentos/$cursoId"
                params={{ cursoId: c.id }}
                className="relative block aspect-video bg-[var(--navy)] group"
                aria-label={`Abrir o curso ${c.title}`}
              >
                {capa && (
                  <img
                    src={capa}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover opacity-90"
                  />
                )}
                <span className="absolute inset-0 grid place-items-center">
                  <PlayCircle
                    size={48}
                    className="text-white drop-shadow-lg transition-transform group-hover:scale-110"
                    aria-hidden
                  />
                </span>
                {ok === aulas.length && aulas.length > 0 && (
                  <span className="absolute top-2 left-2 rounded-full bg-green-600 text-white text-[11px] font-bold px-2 py-0.5 inline-flex items-center gap-1">
                    <CheckCircle2 size={12} aria-hidden /> Concluído
                  </span>
                )}
                {isSuperAdmin && !c.published && (
                  <span className="absolute top-2 right-2 rounded-full bg-amber-500 text-white text-[11px] font-bold px-2 py-0.5">
                    Rascunho
                  </span>
                )}
              </Link>
              <div className="p-3 flex-1 flex flex-col gap-2">
                <div className="flex items-start gap-2">
                  <h2 className="font-semibold text-[var(--navy)] leading-snug flex-1">
                    {c.title}
                  </h2>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => setEditando(c)}
                      className="h-8 w-8 grid place-items-center rounded-md hover:bg-[var(--surface)] text-muted-foreground"
                      aria-label={`Editar o curso ${c.title}`}
                    >
                      <Pencil size={15} aria-hidden />
                    </button>
                  )}
                </div>
                {c.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                )}
                <p className="text-xs text-muted-foreground mt-auto">
                  {aulas.length} aula{aulas.length === 1 ? "" : "s"}
                  {minutos(aulas) ? ` · ${duracao(minutos(aulas))}` : ""}
                  {isSuperAdmin ? ` · ${PUBLICO_LABEL[c.audience]}` : ""}
                </p>
                <div>
                  <div
                    className="h-1.5 rounded-full bg-[var(--surface)] overflow-hidden"
                    aria-hidden
                  >
                    <div className="h-full bg-[var(--gold)]" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {ok} de {aulas.length} aula{aulas.length === 1 ? "" : "s"} concluída
                    {ok === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {editando && (
        <EditorCurso
          curso={editando === "novo" ? null : editando}
          proxPos={cursos.length}
          onClose={() => setEditando(null)}
        />
      )}
    </>
  );
}

// ─── Editor do curso (só ADM) ───────────────────────────────────────────────

type AulaRascunho = {
  id?: string;
  title: string;
  link: string;
  duration: string;
  description: string;
};

function EditorCurso({
  curso,
  proxPos,
  onClose,
}: {
  curso: Curso | null;
  proxPos: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [title, setTitle] = useState(curso?.title ?? "");
  const [description, setDescription] = useState(curso?.description ?? "");
  const [audience, setAudience] = useState<Publico>(curso?.audience ?? "all");
  const [published, setPublished] = useState(curso?.published ?? false);
  const [aulas, setAulas] = useState<AulaRascunho[]>(
    curso?.training_lessons.map((a) => ({
      id: a.id,
      title: a.title,
      link: `https://youtu.be/${a.youtube_id}`,
      duration: a.duration_min ? String(a.duration_min) : "",
      description: a.description ?? "",
    })) ?? [{ title: "", link: "", duration: "", description: "" }],
  );

  const mudar = (i: number, p: Partial<AulaRascunho>) =>
    setAulas((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const mover = (i: number, d: number) =>
    setAulas((xs) => {
      const ys = [...xs];
      [ys[i], ys[i + d]] = [ys[i + d], ys[i]];
      return ys;
    });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Dê um nome ao curso.");
      const validas = aulas.filter((a) => a.title.trim() || a.link.trim());
      if (!validas.length) throw new Error("Inclua ao menos uma aula.");
      const linhas = validas.map((a, i) => {
        const yt = codigoYoutube(a.link);
        if (!a.title.trim()) throw new Error(`Aula ${i + 1}: falta o título.`);
        if (!yt) throw new Error(`Aula ${i + 1}: o link do YouTube não é válido.`);
        const min = a.duration.trim() ? Number(a.duration) : null;
        if (min != null && (!Number.isFinite(min) || min < 0))
          throw new Error(`Aula ${i + 1}: duração inválida.`);
        return {
          ...(a.id ? { id: a.id } : {}),
          title: a.title.trim(),
          description: a.description.trim() || null,
          youtube_id: yt,
          duration_min: min == null ? null : Math.round(min),
          position: i,
        };
      });

      const dados = {
        title: title.trim(),
        description: description.trim() || null,
        audience,
        published,
        updated_at: new Date().toISOString(),
      };
      let id = curso?.id;
      if (id) {
        const { error } = await db.from("training_courses").update(dados).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await db
          .from("training_courses")
          .insert({ ...dados, position: proxPos, created_by: user?.id })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id as string;
      }
      // aulas removidas (o progresso delas sai junto)
      const ficam = new Set(linhas.flatMap((l) => ("id" in l && l.id ? [l.id] : [])));
      const sair = (curso?.training_lessons ?? []).filter((a) => !ficam.has(a.id)).map((a) => a.id);
      if (sair.length) {
        const { error } = await db.from("training_lessons").delete().in("id", sair);
        if (error) throw error;
      }
      const existentes = linhas.filter((l) => "id" in l && l.id);
      const novas = linhas.filter((l) => !("id" in l && l.id));
      if (existentes.length) {
        const { error } = await db
          .from("training_lessons")
          .upsert(existentes.map((l) => ({ ...l, course_id: id })));
        if (error) throw error;
      }
      if (novas.length) {
        const { error } = await db
          .from("training_lessons")
          .insert(novas.map((l) => ({ ...l, course_id: id })));
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Curso salvo");
      await qc.invalidateQueries({ queryKey: ["treinamentos"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("training_courses").delete().eq("id", curso!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Curso excluído");
      await qc.invalidateQueries({ queryKey: ["treinamentos"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{curso ? "Editar curso" : "Novo curso"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block">
            <span className={rotuloCls}>Nome do curso</span>
            <input
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
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
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className={rotuloCls}>Para quem</span>
              <select
                className={inputCls}
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
            <label className="inline-flex items-center gap-2 h-10 text-sm">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                className="h-4 w-4"
              />
              Publicado (aparece para a equipe)
            </label>
          </div>

          <div className="space-y-2">
            <span className={rotuloCls}>Aulas</span>
            {aulas.map((a, i) => {
              const yt = a.link.trim() ? codigoYoutube(a.link) : null;
              return (
                <div
                  key={a.id ?? `n${i}`}
                  className="rounded-xl border border-border p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-muted-foreground w-6">{i + 1}.</span>
                    <input
                      className={inputCls}
                      placeholder="Título da aula"
                      value={a.title}
                      onChange={(e) => mudar(i, { title: e.target.value })}
                      aria-label={`Título da aula ${i + 1}`}
                    />
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => mover(i, -1)}
                      className="h-9 w-9 grid place-items-center rounded-md hover:bg-[var(--surface)] disabled:opacity-30"
                      aria-label="Subir a aula"
                    >
                      <ArrowUp size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={i === aulas.length - 1}
                      onClick={() => mover(i, 1)}
                      className="h-9 w-9 grid place-items-center rounded-md hover:bg-[var(--surface)] disabled:opacity-30"
                      aria-label="Descer a aula"
                    >
                      <ArrowDown size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setAulas((xs) => xs.filter((_, j) => j !== i))}
                      className="h-9 w-9 grid place-items-center rounded-md hover:bg-red-50 text-red-600"
                      aria-label="Remover a aula"
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  </div>
                  <div className="flex gap-2 pl-8">
                    <input
                      className={inputCls}
                      placeholder="Link do YouTube (não listado)"
                      value={a.link}
                      onChange={(e) => mudar(i, { link: e.target.value })}
                      aria-label={`Link do YouTube da aula ${i + 1}`}
                    />
                    <input
                      className={`${campoCls} w-20 shrink-0`}
                      placeholder="Min"
                      inputMode="numeric"
                      value={a.duration}
                      onChange={(e) => mudar(i, { duration: e.target.value.replace(/\D/g, "") })}
                      aria-label={`Duração em minutos da aula ${i + 1}`}
                    />
                  </div>
                  {a.link.trim() && !yt && (
                    <p className="pl-8 text-xs text-red-600">Link do YouTube não reconhecido.</p>
                  )}
                  <textarea
                    className={`${campoCls} block h-14 py-2 ml-8 w-[calc(100%-2rem)]`}
                    placeholder="Resumo da aula (opcional)"
                    value={a.description}
                    onChange={(e) => mudar(i, { description: e.target.value })}
                    aria-label={`Resumo da aula ${i + 1}`}
                  />
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                setAulas((xs) => [...xs, { title: "", link: "", duration: "", description: "" }])
              }
              className="h-9 px-3 rounded-lg border border-dashed border-border text-sm inline-flex items-center gap-1.5 hover:bg-[var(--surface)]"
            >
              <Plus size={15} aria-hidden /> Adicionar aula
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            {curso ? (
              <button
                type="button"
                onClick={() =>
                  confirm(`Excluir o curso "${curso.title}" e o progresso de todos nele?`) &&
                  excluir.mutate()
                }
                disabled={excluir.isPending}
                className="h-10 px-3 rounded-lg text-sm text-red-600 hover:bg-red-50"
              >
                Excluir curso
              </button>
            ) : (
              <span />
            )}
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

// ─── Acompanhamento (ADM: todos; gestor: a própria equipe) ──────────────────

type Pessoa = { id: string; full_name: string; role: string; manager_id: string | null };

function Acompanhamento() {
  const { user, isSuperAdmin } = useAuth();
  const cursosQ = useCursos();
  const pessoasQ = useQuery({
    queryKey: ["treinamentos", "pessoas", isSuperAdmin, user?.id],
    queryFn: async (): Promise<Pessoa[]> => {
      let q = db
        .from("profiles")
        .select("id,full_name,role,manager_id")
        .eq("is_active", true)
        .eq("is_test", false)
        .in("role", ["broker", "master"])
        .order("full_name");
      if (!isSuperAdmin) q = q.eq("manager_id", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Pessoa[];
    },
  });
  const progQ = useQuery({
    queryKey: ["treinamentos", "progresso-todos"],
    queryFn: async () => {
      const { data, error } = await db.from("training_progress").select("user_id,lesson_id");
      if (error) throw error;
      const m = new Map<string, Set<string>>();
      for (const r of (data ?? []) as { user_id: string; lesson_id: string }[]) {
        if (!m.has(r.user_id)) m.set(r.user_id, new Set());
        m.get(r.user_id)!.add(r.lesson_id);
      }
      return m;
    },
  });
  const nomes = useMemo(
    () => new Map((pessoasQ.data ?? []).map((p) => [p.id, p.full_name])),
    [pessoasQ.data],
  );

  const cursos = (cursosQ.data ?? []).filter((c) => c.published && c.training_lessons.length);
  const pessoas = pessoasQ.data ?? [];
  const prog = progQ.data ?? new Map<string, Set<string>>();
  const doPublico = (c: Curso, p: Pessoa) => c.audience === "all" || c.audience === p.role;

  if (cursosQ.isPending || pessoasQ.isPending || progQ.isPending)
    return <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>;
  const erro = cursosQ.error || pessoasQ.error || progQ.error;
  if (erro)
    return <p className="text-sm text-red-600 py-6 text-center">{(erro as Error).message}</p>;
  if (!cursos.length)
    return (
      <p className="text-sm text-muted-foreground py-10 text-center">
        Nenhum curso publicado com aulas ainda.
      </p>
    );

  return (
    <div className="bg-white rounded-2xl border border-border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface)] text-xs text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-[var(--surface)]">
              Nome
            </th>
            {isSuperAdmin && <th className="text-left px-3 py-2 font-semibold">Equipe</th>}
            {cursos.map((c) => (
              <th key={c.id} className="text-left px-3 py-2 font-semibold min-w-[8rem]">
                {c.title}
              </th>
            ))}
            <th className="text-left px-3 py-2 font-semibold">Cursos concluídos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {pessoas.map((p) => {
            const feitas = prog.get(p.id) ?? new Set<string>();
            const meus = cursos.filter((c) => doPublico(c, p));
            const concluidos = meus.filter((c) =>
              c.training_lessons.every((a) => feitas.has(a.id)),
            ).length;
            return (
              <tr key={p.id}>
                <td className="px-3 py-2 font-medium text-[var(--navy)] whitespace-nowrap sticky left-0 bg-white">
                  {p.full_name}
                </td>
                {isSuperAdmin && (
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {p.role === "master"
                      ? "Gestor"
                      : (p.manager_id && nomes.get(p.manager_id)) || "—"}
                  </td>
                )}
                {cursos.map((c) => {
                  if (!doPublico(c, p))
                    return (
                      <td key={c.id} className="px-3 py-2 text-muted-foreground/50">
                        —
                      </td>
                    );
                  const ok = c.training_lessons.filter((a) => feitas.has(a.id)).length;
                  const tudo = ok === c.training_lessons.length;
                  return (
                    <td
                      key={c.id}
                      className={`px-3 py-2 tabular-nums ${tudo ? "text-green-700 font-semibold" : ok ? "text-amber-700" : "text-muted-foreground"}`}
                    >
                      {tudo ? "Concluído" : `${ok}/${c.training_lessons.length}`}
                    </td>
                  );
                })}
                <td className="px-3 py-2 tabular-nums font-semibold">
                  {concluidos}/{meus.length}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
