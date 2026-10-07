import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { AuthSplash } from "@/components/AuthSplash";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

// Entrada do app (start_url do PWA): espera a sessão salva carregar antes de
// decidir. Quem já está logado vai direto para o app, sem passar pelo login.
function IndexPage() {
  const { session, loading } = useAuth();
  if (loading) return <AuthSplash />;
  return <Navigate to={session ? "/dashboard" : "/login"} replace />;
}
