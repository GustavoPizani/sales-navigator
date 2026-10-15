import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { criarServidorAnalise } from "@/lib/mcp/analise.server";

// MCP da Análise Hypnobox para o Claude no navegador (Configurações › Conectores ›
// Adicionar conector personalizado, com a URL https://<site>/api/mcp/<token>).
// O token (MCP_ANALISE_TOKEN) é a senha: quem tiver a URL lê a análise (sem contatos).

function tokenValido(recebido: string) {
  const esperado = process.env.MCP_ANALISE_TOKEN ?? "";
  if (esperado.length < 32 || recebido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

async function atender({ request, params }: { request: Request; params: { token: string } }) {
  if (!tokenValido(params.token)) return new Response("Não encontrado", { status: 404 });
  // sem sessão: cada requisição tem seu servidor (a Vercel não guarda estado entre chamadas)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = criarServidorAnalise();
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const Route = createFileRoute("/api/mcp/$token")({
  server: {
    handlers: {
      POST: atender,
      GET: atender,
      DELETE: atender,
    },
  },
});
