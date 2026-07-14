import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

export const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidEmail = Deno.env.get("VAPID_EMAIL") ?? "suporte@example.com";

if (vapidPublic && vapidPrivate) {
  webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublic, vapidPrivate);
}

// Sends a push notification to every device the given user is subscribed on.
// Cleans up subscriptions the push service reports as gone (410/404).
export async function sendPushToUser(userId: string, title: string, body: string, url?: string) {
  if (!vapidPublic || !vapidPrivate) {
    console.error("[PUSH] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configurados");
    return;
  }

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return;

  const payload = JSON.stringify({ title, body, url });

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("[PUSH] Falha ao enviar:", err.message);
        }
      }
    })
  );
}
