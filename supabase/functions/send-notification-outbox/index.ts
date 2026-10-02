import { admin, sendPushToUser } from "../_shared/push.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Runs every minute (pg_cron, see migration 20260930000009). Sends the push
// notifications queued in notification_outbox by database routines (roulette
// check-in: missed check-ins, stand-by allocation, admin decisions).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = admin();
    const { data: pending, error } = await supabase
      .from("notification_outbox")
      .select("id, user_id, title, body, url")
      .is("sent_at", null)
      .order("created_at")
      .limit(200);
    if (error) throw error;

    let sent = 0;
    for (const n of pending ?? []) {
      // marca antes de enviar para não duplicar se duas execuções se sobrepuserem
      const { data: claimed } = await supabase
        .from("notification_outbox")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", n.id)
        .is("sent_at", null)
        .select("id");
      if (!claimed?.length) continue;
      await sendPushToUser(n.user_id, { title: n.title, body: n.body, url: n.url ?? "/" });
      sent++;
    }

    return new Response(JSON.stringify({ sent }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[send-notification-outbox]", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
