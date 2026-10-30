import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCircle2, ChevronRight, Circle, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { AppHeader } from "@/components/AppHeader";
import { RequireModule } from "@/components/RequireModule";
import { useAuth } from "@/hooks/useAuth";
import { db, duracao, useCursos, useMeuProgresso } from "@/lib/treinamentos";

export const Route = createFileRoute("/_authenticated/treinamentos_/$cursoId")({
  validateSearch: (s: Record<string, unknown>): { aula?: string } => ({
    aula: typeof s.aula === "string" ? s.aula : undefined,
  }),
  component: () => (
    // cursos em vídeo: só o ADM por enquanto
    <RequireModule adminOnly>
      <CursoPage />
    </RequireModule>
  ),
});

function CursoPage() {
  const { cursoId } = Route.useParams();
  const { aula: aulaId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { user } = useAuth();
  const qc = useQueryClient();
  const cursosQ = useCursos();
  const progQ = useMeuProgresso(user?.id);
  const feitas = progQ.data ?? new Set<string>();

  const curso = cursosQ.data?.find((c) => c.id === cursoId);
  const aulas = curso?.training_lessons ?? [];
  // sem aula escolhida: a primeira que falta concluir
  const atual =
    aulas.find((a) => a.id === aulaId) ?? aulas.find((a) => !feitas.has(a.id)) ?? aulas[0];
  const i = atual ? aulas.indexOf(atual) : -1;
  const proxima = i >= 0 ? aulas[i + 1] : undefined;
  const concluida = atual ? feitas.has(atual.id) : false;

  const irPara = (id: string) => navigate({ search: { aula: id }, replace: true });

  const marcar = useMutation({
    mutationFn: async (feita: boolean) => {
      if (!user || !atual) return;
      const { error } = feita
        ? await db
            .from("training_progress")
            .upsert({ user_id: user.id, lesson_id: atual.id }, { ignoreDuplicates: true })
        : await db
            .from("training_progress")
            .delete()
            .eq("user_id", user.id)
            .eq("lesson_id", atual.id);
      if (error) throw error;
    },
    onSuccess: async (_, feita) => {
      await qc.invalidateQueries({ queryKey: ["treinamentos", "progresso"] });
      await qc.invalidateQueries({ queryKey: ["treinamentos", "progresso-todos"] });
      if (feita && proxima) irPara(proxima.id);
      else if (feita) toast.success("Curso concluído!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ok = aulas.filter((a) => feitas.has(a.id)).length;

  return (
    <div className="pb-nav">
      <AppHeader
        title={curso?.title ?? "Treinamento"}
        left={
          <Link
            to="/treinamentos"
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-white/10"
            aria-label="Voltar aos treinamentos"
          >
            <ArrowLeft size={18} aria-hidden />
          </Link>
        }
      />
      <div className="px-4 pt-4 max-w-6xl mx-auto">
        {cursosQ.isPending && (
          <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
        )}
        {!cursosQ.isPending && !curso && (
          <p className="text-sm text-muted-foreground py-10 text-center">
            Curso não encontrado ou não disponível para você.{" "}
            <Link to="/treinamentos" className="underline">
              Voltar aos treinamentos
            </Link>
          </p>
        )}
        {curso && !atual && (
          <p className="text-sm text-muted-foreground py-10 text-center">
            Este curso ainda não tem aulas.
          </p>
        )}

        {curso && atual && (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <section aria-label="Aula atual" className="space-y-3 min-w-0">
              <div className="aspect-video rounded-2xl overflow-hidden bg-black">
                <iframe
                  key={atual.id}
                  src={`https://www.youtube-nocookie.com/embed/${atual.youtube_id}?rel=0&modestbranding=1`}
                  title={atual.title}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-xs text-muted-foreground">
                    Aula {i + 1} de {aulas.length}
                    {atual.duration_min ? ` · ${duracao(atual.duration_min)}` : ""}
                  </p>
                  <h2 className="text-lg font-semibold text-[var(--navy)]">{atual.title}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => marcar.mutate(!concluida)}
                  disabled={marcar.isPending}
                  className={`h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 ${
                    concluida
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-[var(--navy)] text-white"
                  }`}
                >
                  {marcar.isPending ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                  ) : concluida ? (
                    <CheckCircle2 size={15} aria-hidden />
                  ) : (
                    <Check size={15} aria-hidden />
                  )}
                  {concluida
                    ? "Concluída · desfazer"
                    : proxima
                      ? "Concluí, próxima aula"
                      : "Concluí a aula"}
                </button>
                {concluida && proxima && (
                  <button
                    type="button"
                    onClick={() => irPara(proxima.id)}
                    className="h-10 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-1 hover:bg-[var(--surface)]"
                  >
                    Próxima <ChevronRight size={15} aria-hidden />
                  </button>
                )}
              </div>
              {atual.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {atual.description}
                </p>
              )}
            </section>

            <aside
              aria-label="Aulas do curso"
              className="bg-white rounded-2xl border border-border self-start"
            >
              <div className="px-3 py-2 border-b border-border">
                <p className="text-sm font-semibold text-[var(--navy)]">Aulas</p>
                <p className="text-xs text-muted-foreground">
                  {ok} de {aulas.length} concluída{ok === 1 ? "" : "s"}
                </p>
              </div>
              <ol className="divide-y divide-border">
                {aulas.map((a, j) => {
                  const feita = feitas.has(a.id);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => irPara(a.id)}
                        aria-current={a.id === atual.id ? "true" : undefined}
                        className={`w-full text-left px-3 py-2.5 flex items-start gap-2 text-sm hover:bg-[var(--surface)] ${a.id === atual.id ? "bg-[var(--surface)] font-semibold" : ""}`}
                      >
                        {feita ? (
                          <CheckCircle2
                            size={16}
                            className="text-green-600 mt-0.5 shrink-0"
                            aria-label="Concluída"
                          />
                        ) : (
                          <Circle
                            size={16}
                            className="text-muted-foreground/50 mt-0.5 shrink-0"
                            aria-label="A fazer"
                          />
                        )}
                        <span className="flex-1">
                          {j + 1}. {a.title}
                          {a.duration_min ? (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {duracao(a.duration_min)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
