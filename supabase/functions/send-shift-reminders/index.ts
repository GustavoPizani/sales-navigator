import { admin, sendPushToUser } from "../_shared/push.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Brazil has used a fixed UTC-3 offset (no DST) since 2019 — good enough for
// this app's audience without pulling in a timezone library.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function toBRT(date: Date): Date {
  return new Date(date.getTime() - BRT_OFFSET_MS);
}

function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isNightShift(startTime: string): boolean {
  const [h] = startTime.split(":").map(Number);
  return h >= 18 || h < 5;
}

// Runs every 10 minutes (see migration). For every manager who configured a
// shift_reminder_time, checks whether "now" (Brazil local time) just crossed
// that time of day, and if so notifies every broker with a shift tomorrow.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = admin();
    const now = new Date();
    const brt = toBRT(now);
    const nowMinutes = brt.getUTCHours() * 60 + brt.getUTCMinutes();

    const tomorrowStr = new Date(brt.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: managers, error: mgrError } = await supabase
      .from("profiles")
      .select("id, shift_reminder_time")
      .not("shift_reminder_time", "is", null);

    if (mgrError) throw mgrError;

    let notified = 0;
    for (const mgr of managers ?? []) {
      const configuredMinutes = timeStringToMinutes(mgr.shift_reminder_time as string);
      const diff = nowMinutes - configuredMinutes;
      // Fires once, within the 10-minute window after the configured time.
      if (diff < 0 || diff >= 10) continue;

      const { data: shifts, error: shiftsError } = await supabase
        .from("shifts")
        .select("id, broker_id, start_time, end_time")
        .eq("manager_id", mgr.id)
        .eq("date", tomorrowStr)
        .is("reminder_sent_at", null);

      if (shiftsError) throw shiftsError;

      for (const shift of shifts ?? []) {
        const night = isNightShift(shift.start_time);
        const payload = {
          title: night ? "🌙 Plantão noturno amanhã" : "🗓️ Plantão amanhã",
          body: `Das ${shift.start_time.slice(0, 5)} às ${shift.end_time.slice(0, 5)}`,
          url: "/schedule",
        };

        await sendPushToUser(shift.broker_id, payload);

        await supabase
          .from("shifts")
          .update({ reminder_sent_at: now.toISOString() })
          .eq("id", shift.id);

        notified++;
      }
    }

    return new Response(JSON.stringify({ ok: true, notified }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[send-shift-reminders]", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
