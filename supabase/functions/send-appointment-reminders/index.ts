import { admin, sendPushToUser } from "../_shared/push.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function apptDateTime(a: any): Date | null {
  // Try common column shapes: (date + start_time) or scheduled_at/starts_at
  if (a.scheduled_at) return new Date(a.scheduled_at);
  if (a.starts_at) return new Date(a.starts_at);
  if (a.date && a.start_time) return new Date(`${a.date}T${a.start_time}`);
  if (a.date && a.time) return new Date(`${a.date}T${a.time}`);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = admin();
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Fetch appointments (columns vary — select * to be resilient)
    const { data: appts, error } = await supabase
      .from("appointments")
      .select("*, owner:profiles!appointments_owner_id_fkey(id, full_name, manager_id), project:projects(name)")
      .is("reminder_sent_at", null);

    if (error) throw error;

    let notified = 0;
    for (const a of appts ?? []) {
      const owner: any = (a as any).owner;
      const project: any = (a as any).project;
      const managerId = owner?.manager_id;
      if (!managerId) continue;

      const when = apptDateTime(a);
      if (!when) continue;

      const diffMin = (when.getTime() - now.getTime()) / 60000;
      if (diffMin < 0 || when > in24h) continue;

      // fetch manager reminder_minutes
      const { data: mgr } = await supabase
        .from("profiles")
        .select("reminder_minutes")
        .eq("id", managerId)
        .maybeSingle();

      const window = mgr?.reminder_minutes;
      if (!window || window <= 0) continue;

      if (diffMin > window) continue;

      const label = diffMin < 1 ? "agora" : `em ${Math.round(diffMin)} min`;
      const payload = {
        title: `⏰ Agendamento ${label}`,
        body: `${owner?.full_name ?? "Corretor"} — ${project?.name ?? "imóvel"}`,
        url: "/agendamentos",
      };

      await sendPushToUser(managerId, payload);
      if (owner?.id) await sendPushToUser(owner.id, payload);

      await supabase
        .from("appointments")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", (a as any).id);

      notified++;
    }

    return new Response(JSON.stringify({ ok: true, notified }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-appointment-reminders]", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
