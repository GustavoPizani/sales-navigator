import { createFileRoute } from "@tanstack/react-router";
import { CORS, emitirToken } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/api/oauth/token")({
  server: {
    handlers: {
      POST: ({ request }) => emitirToken(request),
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
    },
  },
});
