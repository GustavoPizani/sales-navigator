import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { session, profile, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <div className="min-h-screen grid place-items-center text-muted-foreground">Setting up your account…</div>;
  if (!profile.is_active)
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <h2 className="text-xl font-semibold text-[var(--navy)]">Account inactive</h2>
          <p className="text-muted-foreground mt-2">Contact your administrator.</p>
        </div>
      </div>
    );
  return (
    <div className="min-h-screen bg-[var(--surface)]">
      <Outlet />
      <BottomNav />
    </div>
  );
}
