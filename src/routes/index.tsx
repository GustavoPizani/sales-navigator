import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  component: () => {
    const { session, loading } = useAuth();
    if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
    return <Navigate to={session ? "/my-day" : "/login"} replace />;
  },
});
