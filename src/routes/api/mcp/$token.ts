import { createFileRoute } from "@tanstack/react-router";
import { CORS, atenderMcp, senhaCorreta } from "@/lib/mcp/oauth.server";

// MCP com a senha na URL (/api/mcp/<MCP_ANALISE_TOKEN>): para clientes que não
// fazem login (ex.: Claude Code). O Claude no navegador usa /api/mcp, com login.
async function atender({ request, params }: { request: Request; params: { token: string } }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!senhaCorreta(params.token)) return new Response("Não encontrado", { status: 404 });
  return atenderMcp(request);
}

export const Route = createFileRoute("/api/mcp/$token")({
  server: { handlers: { POST: atender, GET: atender, DELETE: atender, OPTIONS: atender } },
});
