import { createFileRoute } from "@tanstack/react-router";
import { CORS, registrar } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/api/oauth/register")({
  server: {
    handlers: {
      POST: ({ request }) => registrar(request),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});
