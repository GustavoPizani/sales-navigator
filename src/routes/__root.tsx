import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "react-hot-toast";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/hooks/useAuth";
import { IOSInstallBanner } from "@/components/IOSInstallBanner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" },
      { title: "Gestão Comercial" },
      { name: "description", content: "Sales team management for construction company." },
      { name: "theme-color", content: "#0C2340" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "GC" },
      { name: "format-detection", content: "telephone=no" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "icon", href: "/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center text-center p-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--navy)]">404</h1>
        <p className="text-muted-foreground mt-2">Page not found</p>
        <a href="/" className="inline-block mt-4 px-4 py-2 rounded-lg bg-[var(--navy)] text-white">Go home</a>
      </div>
    </div>
  ),
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      const isPreview =
        window.location.hostname.includes("id-preview--") ||
        window.location.hostname.includes("lovableproject.com");
      const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
      if (isPreview || inIframe) {
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      } else {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }
    }
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <IOSInstallBanner />
        <Outlet />
        <Toaster position="top-center" toastOptions={{ duration: 3000 }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
