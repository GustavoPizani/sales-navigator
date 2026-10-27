import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import termo from "../../docs/extensao/termo-de-uso-corretores.md?raw";

// Termo de uso da extensão do WhatsApp, público (a extensão e a guia apontam para cá).
// O texto vem de docs/extensao/termo-de-uso-corretores.md.

export const Route = createFileRoute("/termo-extensao")({
  head: () => ({ meta: [{ title: "Termo de uso da extensão — Gestão Comercial" }] }),
  component: TermoExtensao,
});

/** **negrito** dentro de uma linha. */
const inline = (s: string): ReactNode[] =>
  s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p));

function blocos(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (!lista.length) return;
    out.push(
      <ul key={out.length} className="mb-3 list-disc space-y-1 pl-5">
        {lista.map((l, i) => (
          <li key={i}>{inline(l)}</li>
        ))}
      </ul>,
    );
    lista = [];
  };
  for (const linha of md.split(/\r?\n/)) {
    const t = linha.trim();
    if (t.startsWith("- ")) {
      lista.push(t.slice(2));
      continue;
    }
    fecharLista();
    if (!t) continue;
    if (t.startsWith("# ")) out.push(<h1 key={out.length} className="mb-1 text-xl font-bold">{t.slice(2)}</h1>);
    else if (t.startsWith("## ")) out.push(<h2 key={out.length} className="mb-2 mt-5 text-base font-semibold">{t.slice(3)}</h2>);
    else out.push(<p key={out.length} className="mb-3">{inline(t)}</p>);
  }
  fecharLista();
  return out;
}

function TermoExtensao() {
  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-8">
      <article className="mx-auto max-w-2xl rounded-2xl border border-border bg-white p-6 text-sm leading-relaxed text-[var(--navy)]">
        {blocos(termo)}
      </article>
    </main>
  );
}
