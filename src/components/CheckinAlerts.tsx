import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import toast from "react-hot-toast";
import { MapPin } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// (notification_outbox ainda não está nos tipos gerados do Supabase)
const db = supabase as any;

type Alert = { id: string; title: string; body: string; url: string | null; created_at: string };

/**
 * Admin: aviso de cada check-in enquanto o app está aberto (também em outra
 * aba, pela notificação do sistema). Lê os avisos que o banco gera a cada
 * check-in; não depende do push estar funcionando.
 */
export function CheckinAlerts() {
  const { user, isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || !isSuperAdmin) return;
    // só o que chegar depois de abrir o app
    let since = new Date().toISOString();
    let stopped = false;

    const check = async () => {
      const { data, error } = await db
        .from("notification_outbox")
        .select("id,title,body,url,created_at")
        .eq("user_id", user.id)
        .like("title", "Check-in:%")
        .gt("created_at", since)
        .order("created_at")
        .limit(20);
      if (stopped || error || !data?.length) return;
      since = data[data.length - 1].created_at;
      for (const a of data as Alert[]) show(a);
    };

    const show = (a: Alert) => {
      const open = () => navigate({ to: a.url ?? "/checkin" });
      toast(
        (t) => (
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id);
              open();
            }}
            className="flex items-start gap-3 text-left text-sm"
          >
            <MapPin size={18} className="text-[var(--gold-dark)] flex-shrink-0 mt-0.5" />
            <span>
              <b className="block text-[var(--navy)]">{a.title}</b>
              <span className="text-muted-foreground">{a.body}</span>
            </span>
          </button>
        ),
        { id: a.id, duration: 8000 },
      );
      if (
        document.visibilityState === "hidden" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          const n = new Notification(a.title, { body: a.body, tag: a.id, icon: "/icon-192.png" });
          n.onclick = () => {
            window.focus();
            open();
            n.close();
          };
        } catch {
          /* celular: só pelo service worker (push) */
        }
      }
    };

    const id = setInterval(check, 20_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [user?.id, isSuperAdmin, navigate]);

  return null;
}
