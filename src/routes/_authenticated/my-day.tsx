import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, LogOut, Calendar as CalIcon, ClipboardList, Users as UsersIcon } from "lucide-react";
import toast from "react-hot-toast";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";

export const Route = createFileRoute("/_authenticated/my-day")({
  component: MyDayPage,
});

type Task = {
  id: string; title: string; priority: "high" | "medium" | "low";
  due_date: string; due_time: string | null; is_done: boolean; user_id: string;
};

function MyDayPage() {
  const { profile, user, signOut, isAdmin } = useAuth();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [showAdd, setShowAdd] = useState(false);

  const tasksQ = useQuery({
    queryKey: ["tasks", user?.id, today],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("*")
        .eq("user_id", user!.id).eq("due_date", today)
        .order("is_done").order("priority").order("due_time", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
    enabled: !!user,
  });

  const nextApptQ = useQuery({
    queryKey: ["next-appt", user?.id, today],
    queryFn: async () => {
      const now = format(new Date(), "HH:mm:ss");
      const { data } = await supabase.from("appointments")
        .select("id,title,date,start_time,end_time")
        .eq("owner_id", user!.id)
        .gte("date", today)
        .order("date").order("start_time")
        .limit(5);
      const upcoming = (data ?? []).find((a) => a.date > today || (a.date === today && a.start_time >= now));
      return upcoming || null;
    },
    enabled: !!user,
  });

  const shiftsTodayQ = useQuery({
    queryKey: ["admin-shifts-today", today],
    queryFn: async () => {
      const { count } = await supabase.from("shifts").select("broker_id", { count: "exact", head: true }).eq("date", today);
      return count ?? 0;
    },
    enabled: isAdmin,
  });

  const pending = useMemo(() => (tasksQ.data ?? []).filter((t) => !t.is_done), [tasksQ.data]);
  const filtered = useMemo(() => {
    const arr = tasksQ.data ?? [];
    if (filter === "pending") return arr.filter((t) => !t.is_done);
    if (filter === "done") return arr.filter((t) => t.is_done);
    return arr;
  }, [tasksQ.data, filter]);

  const toggle = useMutation({
    mutationFn: async (t: Task) => {
      const { error } = await supabase.from("tasks").update({ is_done: !t.is_done }).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  const minutesUntil = (a: { date: string; start_time: string }) => {
    const [h, m] = a.start_time.split(":").map(Number);
    const d = parseISO(a.date); d.setHours(h, m, 0, 0);
    return Math.round((d.getTime() - Date.now()) / 60000);
  };

  const upcomingSoon = nextApptQ.data && minutesUntil(nextApptQ.data) >= 0 && minutesUntil(nextApptQ.data) <= 60;
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";

  return (
    <div className="pb-nav">
      <AppHeader title="My Day" right={
        <button onClick={signOut} className="text-white/70 hover:text-white p-2" aria-label="Sign out"><LogOut size={20} /></button>
      } />
      <div className="px-4 pt-4 space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMM d")}</p>
          <h2 className="text-2xl font-bold text-[var(--navy)]">Hello, {firstName}</h2>
        </div>

        {/* Banners */}
        <div className="space-y-2">
          {pending.length > 0 && (
            <div className="rounded-xl bg-[var(--gold)]/15 border border-[var(--gold)]/40 text-[var(--navy)] px-4 py-3 text-sm font-medium">
              You have {pending.length} pending task{pending.length === 1 ? "" : "s"} for today
            </div>
          )}
          {upcomingSoon && (
            <div className="rounded-xl bg-[var(--navy)] text-white px-4 py-3 text-sm font-medium">
              Upcoming: {nextApptQ.data!.title} at {nextApptQ.data!.start_time.slice(0, 5)}
            </div>
          )}
          {isAdmin && (shiftsTodayQ.data ?? 0) > 0 && (
            <div className="rounded-xl bg-white border border-border px-4 py-3 text-sm font-medium text-[var(--navy)] flex items-center gap-2">
              <UsersIcon size={16} className="text-[var(--gold)]" />
              {shiftsTodayQ.data} broker{shiftsTodayQ.data === 1 ? "" : "s"} on shift today
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard icon={<ClipboardList size={18} />} label="Pending tasks" value={String(pending.length)} />
          <SummaryCard icon={<CalIcon size={18} />} label="Next appointment"
            value={nextApptQ.data ? nextApptQ.data.start_time.slice(0, 5) : "—"}
            sub={nextApptQ.data?.title} />
        </div>

        {/* Filter */}
        <div className="flex gap-2 text-sm">
          {(["all", "pending", "done"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 h-8 rounded-full font-medium ${filter === f ? "bg-[var(--navy)] text-white" : "bg-white text-muted-foreground border border-border"}`}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Tasks */}
        <ul className="space-y-2">
          {filtered.length === 0 && (
            <li className="text-center text-muted-foreground py-8 text-sm">No tasks here.</li>
          )}
          {filtered.map((t) => (
            <li key={t.id}
              className="bg-white rounded-xl px-3 py-3 flex items-center gap-3 border border-border">
              <button onClick={() => toggle.mutate(t)}
                className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                  t.is_done ? "bg-[var(--gold)] border-[var(--gold)]" : "border-muted-foreground/40"
                }`} aria-label="Toggle done">
                {t.is_done && <Check size={14} className="text-[var(--navy)]" strokeWidth={3} />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`font-medium text-[var(--navy)] ${t.is_done ? "line-through opacity-50" : ""}`}>{t.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold pri-${t.priority}`}>{t.priority}</span>
                  {t.due_time && <span className="text-xs text-muted-foreground">{t.due_time.slice(0, 5)}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <button onClick={() => setShowAdd(true)}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center"
        aria-label="Add task">
        <Plus size={28} strokeWidth={2.5} />
      </button>

      {showAdd && <AddTaskSheet onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function SummaryCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl p-3 border border-border">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}<span>{label}</span></div>
      <p className="text-xl font-bold text-[var(--navy)] mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground truncate mt-0.5">{sub}</p>}
    </div>
  );
}

function AddTaskSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueTime, setDueTime] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tasks").insert({
        user_id: user!.id, title, priority, due_date: dueDate, due_time: dueTime || null, is_done: false,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Task added"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-3">New task</h3>
        <div className="space-y-3">
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex gap-2">
            {(["high", "medium", "low"] as const).map((p) => (
              <button key={p} onClick={() => setPriority(p)}
                className={`flex-1 h-10 rounded-lg text-sm font-semibold uppercase tracking-wide ${priority === p ? `pri-${p} ring-2 ring-[var(--navy)]` : "bg-[var(--surface)] text-muted-foreground border border-border"}`}>{p}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <input type="time" className="h-12 px-3 rounded-xl bg-[var(--surface)] border border-border" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancel</button>
            <button onClick={() => m.mutate()} disabled={!title || m.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
