import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";

// Silently subscribes the logged-in user to push notifications shortly after
// login, without interrupting navigation. Skips if the browser already
// denied permission, or if a subscription already exists.
export function PushSubscriber() {
  const { user } = useAuth();
  const { supported, subscribed, subscribe } = usePushNotifications();

  useEffect(() => {
    if (!user || !supported || subscribed) return;
    if (typeof Notification !== "undefined" && Notification.permission === "denied") return;

    const id = setTimeout(() => {
      subscribe().catch(() => {});
    }, 3000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, supported, subscribed]);

  return null;
}
