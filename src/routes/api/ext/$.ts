import { createFileRoute } from "@tanstack/react-router";
import { atenderExtensao } from "@/lib/extensao/api.server";

// API da extensão do WhatsApp (/api/ext/...). Ver src/lib/extensao/api.server.ts.
const atender = ({ request }: { request: Request }) => atenderExtensao(request);

export const Route = createFileRoute("/api/ext/$")({
  server: { handlers: { GET: atender, POST: atender, OPTIONS: atender } },
});
