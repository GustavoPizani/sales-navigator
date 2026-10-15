import { createFileRoute } from "@tanstack/react-router";
import { metadadosServidor } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: { handlers: { GET: ({ request }) => metadadosServidor(request) } },
});
