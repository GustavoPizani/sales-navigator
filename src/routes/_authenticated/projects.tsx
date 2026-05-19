import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, MapPin, Edit2, EyeOff, Eye } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
});

type Project = { id: string; name: string; address: string; city: string; description: string | null; is_active: boolean; manager_id: string };

function ProjectsPage() {
  const { isAdmin, user } = useAuth();
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Project | "new" | null>(null);

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
      (data ?? []).forEach((a: any) => { if (a.project_id) map[a.project_id] = (map[a.project_id] || 0) + 1; });
      return map;
    },
  });

  return (
    <div className="pb-nav">
      <AppHeader title="Imóveis" right={
        <button onClick={() => setShowAll(!showAll)} className="text-white/70 p-2" aria-label="Mostrar inativos">
          {showAll ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      } />
      <div className="px-4 pt-4 space-y-2">
        {(projectsQ.data ?? []).length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">Nenhum imóvel ainda. Toque + para adicionar.</p>
        )}
        {(projectsQ.data ?? []).map((p) => (
          <div key={p.id} className={`bg-white rounded-xl p-4 border border-border ${!p.is_active ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[var(--navy)]">{p.name}{!p.is_active && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1"><MapPin size={12} />{p.city}</p>
                <p className="text-xs text-muted-foreground truncate">{p.address}</p>
                <p className="text-xs text-[var(--gold)] font-semibold mt-1">
                  {countsQ.data?.[p.id] ?? 0} visita{(countsQ.data?.[p.id] ?? 0) === 1 ? "" : "s"} agendada{(countsQ.data?.[p.id] ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <button onClick={() => setEditing(p)} className="p-2 text-muted-foreground"><Edit2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setEditing("new")}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center" aria-label="Adicionar imóvel">
        <Plus size={28} strokeWidth={2.5} />
      </button>
      {editing && <ProjectForm project={editing === "new" ? null : editing} managerId={user!.id} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProjectForm({ project, managerId, onClose }: { project: Project | null; managerId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(project?.name ?? "");
  const [address, setAddress] = useState(project?.address ?? "");
  const [city, setCity] = useState(project?.city ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [active, setActive] = useState(project?.is_active ?? true);
  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, address, city, description: description || null, is_active: active, manager_id: managerId };
      if (project) {
        const { error } = await supabase.from("projects").update(payload).eq("id", project.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("projects").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects-all"] }); qc.invalidateQueries({ queryKey: ["projects-active"] }); toast.success("Salvo"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-3">{project ? "Editar" : "Novo"} imóvel</h3>
        <div className="space-y-3">
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Nome do imóvel" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Endereço completo" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Cidade" value={city} onChange={(e) => setCity(e.target.value)} />
          <textarea className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-border min-h-[80px]" placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border">
            <span className="text-sm font-medium text-[var(--navy)]">Ativo</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-5 h-5 accent-[var(--gold)]" />
          </label>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancelar</button>
            <button onClick={() => save.mutate()} disabled={!name || !address || !city || save.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50">Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
