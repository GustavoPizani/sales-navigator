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

function formatLeadLabel(diffMin: number): string {
  if (diffMin < 1) return "agora";
  if (diffMin >= 1440) return `em ${Math.round(diffMin / 1440)} dia(s)`;
  if (diffMin >= 60) return `em ${Math.round(diffMin / 60)}h`;
  return `em ${Math.round(diffMin)} min`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = admin();
    const now = new Date();
    // Wide enough to cover multi-day lead times (e.g. "1 day before") without
    // scanning the whole table.
    const window48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const { data: appts, error } = await supabase
      .from("appointments")
      .select(
        "id, date, start_time, reminder_sent_minutes, owner:profiles!appointments_owner_id_fkey(id, full_name, manager_id), project:projects(name)"
      )
      .gte("date", now.toISOString().slice(0, 10));

    if (error) throw error;

    let notified = 0;
    for (const a of (appts ?? []) as any[]) {
      const owner = a.owner;
      const project = a.project;
      const managerId = owner?.manager_id;
      if (!managerId) continue;

      const when = apptDateTime(a);
      if (!when || when > window48h) continue;

      const diffMin = (when.getTime() - now.getTime()) / 60000;
      if (diffMin < 0) continue;

      const { data: mgr } = await supabase
        .from("profiles")
        .select("reminder_minutes")
        .eq("id", managerId)
        .maybeSingle();

      const leadTimes: number[] = (mgr?.reminder_minutes ?? []).filter((m: number) => m > 0);
      if (leadTimes.length === 0) continue;

      const alreadySent: number[] = a.reminder_sent_minutes ?? [];
      const due = leadTimes.find((lt) => diffMin <= lt && !alreadySent.includes(lt));
      if (due === undefined) continue;

      const label = formatLeadLabel(diffMin);
      const payload = {
        title: `⏰ Agendamento ${label}`,
        body: `${owner?.full_name ?? "Corretor"} — ${project?.name ?? "imóvel"}`,
        url: `/appointments?open=${a.id}`,
      };

      await sendPushToUser(managerId, payload);
      if (owner?.id) await sendPushToUser(owner.id, payload);

      await supabase
        .from("appointments")
        .update({ reminder_sent_minutes: [...alreadySent, due] })
        .eq("id", a.id);

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
