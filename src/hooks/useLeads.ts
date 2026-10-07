import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

export type LeadStatus = Database["public"]["Enums"]["lead_status"];
export type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
export type FunnelStage = Database["public"]["Tables"]["funnel_stages"]["Row"];
export type Funnel = Database["public"]["Tables"]["funnels"]["Row"] & { stages: FunnelStage[] };

export type Lead = LeadRow & {
  broker: { id: string; full_name: string; color: string } | null;
  project: { id: string; name: string } | null;
};

export type HierarchyMember = {
  id: string;
  full_name: string;
  color: string;
  role: string;
  manager_id: string | null;
};

export const TEMPERATURAS = ["Frio", "Morno", "Quente"] as const;

export const temperaturaStyles: Record<string, string> = {
  Frio: "bg-slate-100 text-slate-700 border-slate-200",
  Morno: "bg-amber-100 text-amber-700 border-amber-200",
  Quente: "bg-red-100 text-red-700 border-red-200",
};

export const LEAD_SELECT =
  "*, broker:profiles!leads_broker_id_fkey(id,full_name,color), project:projects(id,name)";

/** Admin e diretor enxergam todos os leads (mesma regra de crm_is_global no banco). */
export function useIsCrmGlobal() {
  const { profile } = useAuth();
  return profile?.role === "admin" || profile?.role === "director";
}

export function useFunnels() {
  return useQuery({
    queryKey: ["funnels"],
    staleTime: 30_000,
    queryFn: async (): Promise<Funnel[]> => {
      const { data, error } = await supabase
        .from("funnels")
        .select("*, stages:funnel_stages(*)")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []).map((f: any) => ({
        ...f,
        stages: [...(f.stages ?? [])].sort(
          (a: FunnelStage, b: FunnelStage) => a.sort_order - b.sort_order,
        ),
      }));
    },
  });
}

/**
 * Pessoas para quem o usuário pode atribuir/filtrar leads: ele mesmo e todos
 * abaixo dele na cadeia manager_id. Admin/diretor: todos os ativos.
 */
export function useHierarchyMembers() {
  const { profile } = useAuth();
  const isGlobal = useIsCrmGlobal();

  const q = useQuery({
    queryKey: ["hierarchy-members", profile?.id],
    enabled: !!profile,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<HierarchyMember[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,color,role,manager_id")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as HierarchyMember[];
    },
  });

  const members = useMemo(() => {
    const all = q.data ?? [];
    if (!profile) return [];
    if (isGlobal) return all;
    const byManager = new Map<string, HierarchyMember[]>();
    all.forEach((m) => {
      if (!m.manager_id) return;
      byManager.set(m.manager_id, [...(byManager.get(m.manager_id) ?? []), m]);
    });
    const result: HierarchyMember[] = [];
    const self = all.find((m) => m.id === profile.id);
    if (self) result.push(self);
    const stack = [profile.id];
    const seen = new Set(stack);
    while (stack.length) {
      for (const child of byManager.get(stack.pop()!) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        result.push(child);
        stack.push(child.id);
      }
    }
    return result.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [q.data, profile, isGlobal]);

  return { ...q, members };
}

export type LeadFilters = {
  funnelId: string | undefined;
  status: LeadStatus | "all";
  brokerId: string; // "all" | id
  temperatura: string; // "all" | valor
  from: string; // yyyy-MM-dd ou ""
  to: string;
};

// Datas do filtro são dias no fuso local; converte para instantes ISO.
const startOfDayIso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDayIso = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: ["leads", filters],
    enabled: !!filters.funnelId,
    queryFn: async (): Promise<Lead[]> => {
      let q = supabase
        .from("leads")
        .select(LEAD_SELECT)
        .eq("funnel_id", filters.funnelId!)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (filters.status !== "all") q = q.eq("status", filters.status);
      if (filters.brokerId !== "all") q = q.eq("broker_id", filters.brokerId);
      if (filters.temperatura !== "all") q = q.eq("temperatura", filters.temperatura);
      // O período vale só para ganhos e perdidos (pela data do ganho/perda, como
      // no Real Sales); clientes em andamento aparecem sempre.
      const from = filters.from ? startOfDayIso(filters.from) : "";
      const to = filters.to ? endOfDayIso(filters.to) : "";
      if (filters.status === "won" || filters.status === "lost") {
        const dateField = filters.status === "won" ? "won_at" : "lost_at";
        if (from) q = q.gte(dateField, from);
        if (to) q = q.lte(dateField, to);
      } else if (filters.status === "all" && (from || to)) {
        const range = (col: string) =>
          (from ? `,${col}.gte.${from}` : "") + (to ? `,${col}.lte.${to}` : "");
        q = q.or(
          `status.eq.active,and(status.eq.won${range("won_at")}),and(status.eq.lost${range("lost_at")})`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
  });
}

/** Atualiza campos de um lead com atualização otimista em todas as listas em cache. */
export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Database["public"]["Tables"]["leads"]["Update"];
    }) => {
      const { error } = await supabase.from("leads").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["leads"] });
      const snapshot = qc.getQueriesData<Lead[]>({ queryKey: ["leads"] });
      qc.setQueriesData<Lead[]>({ queryKey: ["leads"] }, (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      );
      return { snapshot };
    },
    onError: (err: any, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(err?.message ?? "Não foi possível atualizar o lead.");
    },
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["lead-notes", id] });
    },
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async (input: Database["public"]["Tables"]["leads"]["Insert"]) => {
      const { data, error } = await supabase
        .from("leads")
        .insert({ created_by: profile?.id, ...input })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead criado!");
    },
    onError: (err: any) => toast.error(err?.message ?? "Não foi possível criar o lead."),
  });
}

export function useActiveProjects() {
  return useQuery({
    queryKey: ["projects-active-names"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

export function whatsappUrl(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return `https://wa.me/${digits}`;
}
