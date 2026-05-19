import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Phone, MessageCircle, Mail, Edit2 } from "lucide-react";
import toast from "react-hot-toast";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/Avatar";
import { createBroker, updateBroker } from "@/lib/admin.functions";

const COLOR_PALETTE = ["#EF4444","#F59E0B","#10B981","#06B6D4","#3B82F6","#8B5CF6","#EC4899","#C9A84C","#0C2340","#14B8A6"];

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
});

type Profile = { id: string; full_name: string; email: string; phone: string | null; color: string; role: string; is_active: boolean };

function TeamPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/my-day" replace />;
  const [detail, setDetail] = useState<Profile | null>(null);
  const [addNew, setAddNew] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);

  const brokersQ = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("role", "broker").order("full_name");
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  return (
    <div className="pb-nav">
      <AppHeader title="Team" />
      <div className="px-4 pt-4 space-y-2">
        {(brokersQ.data ?? []).length === 0 && (
          <p className="text-center text-muted-foreground py-12 text-sm">No brokers yet. Tap + to add.</p>
        )}
        {(brokersQ.data ?? []).map((p) => (
          <div key={p.id} className={`bg-white rounded-xl p-3 border border-border flex items-center gap-3 ${!p.is_active ? "opacity-60" : ""}`}>
            <Avatar name={p.full_name} color={p.color} />
            <button onClick={() => setDetail(p)} className="flex-1 min-w-0 text-left">
              <p className="font-semibold text-[var(--navy)] truncate">{p.full_name}{!p.is_active && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</p>
              <p className="text-xs text-muted-foreground capitalize">{p.role} · {p.phone || p.email}</p>
            </button>
            <button onClick={() => setEditing(p)} className="p-2 text-muted-foreground"><Edit2 size={16} /></button>
          </div>
        ))}
      </div>
      <button onClick={() => setAddNew(true)}
        className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-full bg-[var(--gold)] text-[var(--navy)] shadow-lg flex items-center justify-center" aria-label="Add broker">
        <Plus size={28} strokeWidth={2.5} />
      </button>
      {detail && <BrokerDetail profile={detail} onClose={() => setDetail(null)} />}
      {addNew && <CreateBrokerForm onClose={() => setAddNew(false)} />}
      {editing && <EditBrokerForm profile={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BrokerDetail({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const shiftsQ = useQuery({
    queryKey: ["broker-detail-shifts", profile.id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from("shifts").select("*").eq("broker_id", profile.id).gte("date", today).order("date").limit(7);
      return data ?? [];
    },
  });
  const apptsQ = useQuery({
    queryKey: ["broker-detail-appts", profile.id],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from("appointments").select("*").eq("owner_id", profile.id).gte("date", today).order("date").order("start_time").limit(10);
      return data ?? [];
    },
  });
  const phoneDigits = profile.phone?.replace(/\D/g, "");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <Avatar name={profile.full_name} color={profile.color} size={56} />
          <div>
            <h3 className="text-lg font-semibold text-[var(--navy)]">{profile.full_name}</h3>
            <p className="text-xs text-muted-foreground capitalize">{profile.role}</p>
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          {profile.phone && <a href={`tel:${profile.phone}`} className="flex-1 h-11 rounded-xl bg-[var(--surface)] flex items-center justify-center gap-1 text-sm font-medium text-[var(--navy)]"><Phone size={14} />Call</a>}
          {phoneDigits && <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className="flex-1 h-11 rounded-xl bg-green-50 text-green-700 flex items-center justify-center gap-1 text-sm font-medium"><MessageCircle size={14} />WhatsApp</a>}
          <a href={`mailto:${profile.email}`} className="flex-1 h-11 rounded-xl bg-[var(--surface)] flex items-center justify-center gap-1 text-sm font-medium text-[var(--navy)]"><Mail size={14} />Email</a>
        </div>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4 mb-2">Week shifts</p>
        {(shiftsQ.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No upcoming shifts.</p> :
          (shiftsQ.data ?? []).map((s: any) => (
            <p key={s.id} className="text-sm text-[var(--navy)]"><b>{s.date}</b> · {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</p>
          ))}

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4 mb-2">Upcoming appointments</p>
        {(apptsQ.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No upcoming appointments.</p> :
          (apptsQ.data ?? []).map((a: any) => (
            <p key={a.id} className="text-sm text-[var(--navy)]"><b>{a.date}</b> · {a.start_time.slice(0,5)} · {a.title}</p>
          ))}

        <button onClick={onClose} className="w-full mt-5 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold">Close</button>
      </div>
    </div>
  );
}

function CreateBrokerForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createBroker);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [color, setColor] = useState(COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]);
  const m = useMutation({
    mutationFn: () => create({ data: { full_name: name, email, phone: phone || null, password, color } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); qc.invalidateQueries({ queryKey: ["brokers-active"] }); toast.success("Broker created"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-3">Add broker</h3>
        <div className="space-y-3">
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="email" className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Phone (e.g. +1 555 123 4567)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input type="password" className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Temporary password (min 8)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div>
            <p className="text-xs text-muted-foreground mb-1">Color</p>
            <div className="flex gap-2 flex-wrap">
              {COLOR_PALETTE.map((c) => (
                <button key={c} onClick={() => setColor(c)} className="w-9 h-9 rounded-full" style={{ background: c, outline: color === c ? "3px solid var(--navy)" : "none", outlineOffset: 1 }} aria-label={c} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancel</button>
            <button onClick={() => m.mutate()} disabled={!name || !email || password.length < 8 || m.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold disabled:opacity-50">{m.isPending ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditBrokerForm({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const qc = useQueryClient();
  const update = useServerFn(updateBroker);
  const [name, setName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [color, setColor] = useState(profile.color);
  const [active, setActive] = useState(profile.is_active);
  const m = useMutation({
    mutationFn: () => update({ data: { id: profile.id, full_name: name, phone: phone || null, color, is_active: active } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); qc.invalidateQueries({ queryKey: ["brokers-active"] }); toast.success("Updated"); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="bg-white w-full rounded-t-2xl p-5 safe-bottom" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-[var(--navy)] mb-3">Edit {profile.full_name}</h3>
        <div className="space-y-3">
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full h-12 px-4 rounded-xl bg-[var(--surface)] border border-border" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div>
            <p className="text-xs text-muted-foreground mb-1">Color</p>
            <div className="flex gap-2 flex-wrap">
              {COLOR_PALETTE.map((c) => (
                <button key={c} onClick={() => setColor(c)} className="w-9 h-9 rounded-full" style={{ background: c, outline: color === c ? "3px solid var(--navy)" : "none", outlineOffset: 1 }} />
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface)] border border-border">
            <span className="text-sm font-medium text-[var(--navy)]">Active</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-5 h-5 accent-[var(--gold)]" />
          </label>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 h-12 rounded-xl bg-[var(--surface)] text-[var(--navy)] font-medium">Cancel</button>
            <button onClick={() => m.mutate()} disabled={m.isPending} className="flex-1 h-12 rounded-xl bg-[var(--navy)] text-white font-semibold">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
