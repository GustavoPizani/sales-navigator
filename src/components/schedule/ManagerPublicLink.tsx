import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MessageCircle } from "lucide-react";
import toast from "react-hot-toast";
import { publicSchedule } from "@/lib/publicSchedule";
import { confirmDialog } from "@/components/ConfirmDialog";

/**
 * Link individual do gerente (só o admin gera): o gerente abre sem login,
 * digita o nome dos corretores e preenche a escala dentro das vagas da equipe.
 */
export function ManagerPublicLink({ managerId }: { managerId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["manager-public-link", managerId],
    queryFn: () => publicSchedule.managerLink(managerId),
  });
  const link = q.data ? `${window.location.origin}/escala/${q.data}` : "";

  const regenerate = async () => {
    if (
      !(await confirmDialog({
        title: "Gerar um novo link?",
        description: "O link atual deixa de funcionar; será preciso enviar o novo ao gerente.",
        confirmLabel: "Gerar novo link",
      }))
    )
      return;
    setBusy(true);
    try {
      const token = await publicSchedule.managerLink(managerId, true);
      qc.setQueryData(["manager-public-link", managerId], token);
      toast.success("Novo link gerado.");
    } catch (err: any) {
      toast.error(err.message || "Erro ao gerar o link");
    } finally {
      setBusy(false);
    }
  };

  const sendWhatsapp = () => {
    const message = `Preencha a escala da sua equipe por este link (não precisa de login). Digite o nome dos corretores e escolha os dias e turnos de cada um:\n\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  return (
    <section className="rounded-2xl border border-[var(--gold)]/40 bg-[var(--gold)]/5 p-4 space-y-3">
      <div>
        <h4 className="font-bold text-[var(--navy)]">Link do gerente (sem login)</h4>
        <p className="text-xs text-muted-foreground">
          O gerente digita o nome dos corretores e preenche a escala, limitado às vagas que você
          definiu em "Vagas das equipes". Vale para todas as semanas com vagas definidas.
        </p>
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.isError && (
        <p className="text-sm text-red-600">
          {(q.error as Error).message || "Erro ao gerar o link"}
        </p>
      )}
      {link && (
        <>
          <p className="text-xs break-all rounded-lg bg-white border border-border px-3 py-2 text-[var(--navy)]">
            {link}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(link);
                toast.success("Link copiado!");
              }}
              className="h-10 px-4 rounded-xl bg-[var(--navy)] text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Copy size={15} /> Copiar link
            </button>
            <button
              type="button"
              onClick={sendWhatsapp}
              className="h-10 px-4 rounded-xl bg-green-600 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <MessageCircle size={15} /> Enviar no WhatsApp
            </button>
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="h-10 px-4 rounded-xl bg-white border border-border text-[var(--navy)] text-sm font-semibold disabled:opacity-60"
            >
              Gerar novo link
            </button>
          </div>
        </>
      )}
    </section>
  );
}
