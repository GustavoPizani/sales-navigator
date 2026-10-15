import { createFileRoute } from "@tanstack/react-router";
import { atenderMcpComLogin } from "@/lib/mcp/oauth.server";

// MCP da Análise Hypnobox para o Claude no navegador (conector personalizado com
// a URL https://<site>/api/mcp). O Claude faz o login pelo OAuth deste site.
const atender = ({ request }: { request: Request }) => atenderMcpComLogin(request);

export const Route = createFileRoute("/api/mcp/")({
  server: { handlers: { POST: atender, GET: atender, DELETE: atender, OPTIONS: atender } },
});
