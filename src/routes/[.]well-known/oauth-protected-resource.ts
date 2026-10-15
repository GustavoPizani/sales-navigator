import { createFileRoute } from "@tanstack/react-router";
import { metadadosRecurso } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: { handlers: { GET: ({ request }) => metadadosRecurso(request) } },
});
