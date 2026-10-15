import { createFileRoute } from "@tanstack/react-router";
import { metadadosRecurso } from "@/lib/mcp/oauth.server";

// mesma resposta para /.well-known/oauth-protected-resource/api/mcp e afins
export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")({
  server: { handlers: { GET: ({ request }) => metadadosRecurso(request) } },
});
