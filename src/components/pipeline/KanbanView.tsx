import { useState } from "react";
import { LeadCard } from "./LeadCard";
import type { FunnelStage, Lead } from "@/hooks/useLeads";

/**
 * Colunas por etapa. Arrastar e soltar usa o DnD nativo do navegador
 * (desktop); no celular a etapa é trocada pela página do lead ou pela planilha.
 */
export function KanbanView({
  stages,
  leads,
  onMove,
  readOnly = false,
}: {
  stages: FunnelStage[];
  leads: Lead[];
  onMove: (leadId: string, stageId: string) => void;
  /** somente visualização: não permite arrastar */
  readOnly?: boolean;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const byStage = new Map<string, Lead[]>(stages.map((s) => [s.id, []]));
  leads.forEach((l) => byStage.get(l.stage_id)?.push(l));

  return (
    <div className="overflow-x-auto pb-2 -mx-4 px-4">
      <div className="flex gap-3 min-w-max items-start">
        {stages.map((stage) => {
          const items = byStage.get(stage.id) ?? [];
          const isOver = overStage === stage.id && draggingId !== null;
          return (
            <section
              key={stage.id}
              className={`w-[280px] flex-shrink-0 flex flex-col rounded-xl border bg-white/60 transition-colors ${isOver ? "border-[var(--gold)] bg-[var(--gold)]/5" : "border-border"}`}
              onDragOver={(e) => {
                if (!draggingId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overStage !== stage.id) setOverStage(stage.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/lead-id") || draggingId;
                const lead = leads.find((l) => l.id === id);
                if (lead && lead.stage_id !== stage.id) onMove(lead.id, stage.id);
                setDraggingId(null);
                setOverStage(null);
              }}
            >
              <header
                className="px-3 py-2.5 rounded-t-xl text-white text-sm font-semibold flex items-center justify-between sticky top-0"
                style={{ backgroundColor: stage.color }}
              >
                <span className="truncate">{stage.name}</span>
                <span className="text-xs font-bold bg-white/25 rounded-full px-2 py-0.5">
                  {items.length}
                </span>
              </header>
              <div className="p-2 space-y-2.5 max-h-[calc(100dvh-18rem)] min-h-[120px] overflow-y-auto">
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">Nenhum lead</p>
                )}
                {items.map((lead) => (
                  <div
                    key={lead.id}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/lead-id", lead.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(lead.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setOverStage(null);
                    }}
                    className={readOnly ? undefined : "cursor-grab active:cursor-grabbing"}
                  >
                    <LeadCard lead={lead} isDragging={draggingId === lead.id} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
