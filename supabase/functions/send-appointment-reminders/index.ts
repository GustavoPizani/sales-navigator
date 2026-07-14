import { sendPushToUser, supabaseAdmin } from "../_shared/push.ts";

// Triggered every minute by pg_cron (see migration). For every appointment in
// the next 24h that hasn't been reminded yet, checks whether it falls inside
// its manager's configured reminder window and, if so, pushes both the
// manager and the broker, then marks it as sent so it's never repeated.
Deno.serve(async (_req) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: appointments, error } = await supabaseAdmin
    .from("appointments")
    .select(
      "id, date, start_time, owner:owner_id(id, full_name, manager_id), project:project_id(name)"
    )
    .is("reminder_sent_at", null)
    .gte("date", today)
    .lte("date", tomorrow);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const managerIds = [
    ...new Set(
      (appointments ?? [])
        .map((a: any) => a.owner?.manager_id)
        .filter((id: string | null): id is string => !!id)
    ),
  ];

  const { data: managers } = managerIds.length
    ? await supabaseAdmin.from("profiles").select("id, reminder_minutes").in("id", managerIds)
    : { data: [] as { id: string; reminder_minutes: number }[] };

  const reminderByManager = new Map((managers ?? []).map((m) => [m.id, m.reminder_minutes]));

  let notified = 0;

  for (const appt of (appointments ?? []) as any[]) {
    const managerId = appt.owner?.manager_id as string | null;
    if (!managerId) continue;

    const reminderMinutes = reminderByManager.get(managerId);
    if (!reminderMinutes || reminderMinutes <= 0) continue;

    const apptDate = new Date(`${appt.date}T${appt.start_time}`);
    const minutesUntil = (apptDate.getTime() - now.getTime()) / 60000;
    if (minutesUntil < 0 || minutesUntil > reminderMinutes) continue;

    const brokerName = appt.owner?.full_name ?? "Corretor";
    const productName = appt.project?.name ?? "imóvel";
    const timeLabel = minutesUntil <= 1 ? "agora" : `em ${Math.round(minutesUntil)} min`;
    const title = `⏰ Agendamento ${timeLabel}`;
    const body = `${brokerName} — ${productName}`;

    await sendPushToUser(managerId, title, body, "/agendamentos");
    if (appt.owner?.id) await sendPushToUser(appt.owner.id, title, body, "/agendamentos");

    await supabaseAdmin
      .from("appointments")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", appt.id);

    notified++;
  }

  return new Response(JSON.stringify({ ok: true, notified, checkedAt: now.toISOString() }), {
    headers: { "Content-Type": "application/json" },
  });
});
