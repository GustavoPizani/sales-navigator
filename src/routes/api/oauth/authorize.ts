import { createFileRoute } from "@tanstack/react-router";
import { autorizar } from "@/lib/mcp/oauth.server";

export const Route = createFileRoute("/api/oauth/authorize")({
  server: {
    handlers: {
      GET: ({ request }) => autorizar(request),
      POST: ({ request }) => autorizar(request),
    },
  },
});
