import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { criarServidorAnalise } from "./analise.server";

// Login (OAuth 2.1 com PKCE) do MCP da Análise Hypnobox para os conectores do
// Claude. Sem banco: o código de autorização e os tokens são assinados (HMAC)
// com uma chave derivada de MCP_ANALISE_TOKEN. Para autorizar, você digita esse
// token uma vez na página de autorização. Trocar o MCP_ANALISE_TOKEN na Vercel
// derruba todos os acessos já concedidos.

const DIA = 24 * 60 * 60;

function segredo() {
  const t = process.env.MCP_ANALISE_TOKEN ?? "";
  if (t.length < 32) throw new Error("MCP_ANALISE_TOKEN ausente ou curto no servidor.");
  return createHmac("sha256", t).update("mcp-oauth-v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function assinar(dados: Record<string, unknown>, validadeSeg: number) {
  const corpo = b64(JSON.stringify({ ...dados, exp: Math.floor(Date.now() / 1000) + validadeSeg }));
  return `${corpo}.${b64(createHmac("sha256", segredo()).update(corpo).digest())}`;
}

export function verificar<T extends Record<string, unknown>>(
  token: string,
  tipo: string,
): T | null {
  const [corpo, sig] = String(token || "").split(".");
  if (!corpo || !sig) return null;
  const esperado = createHmac("sha256", segredo()).update(corpo).digest();
  const recebido = Buffer.from(sig, "base64url");
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (d.typ !== tipo || typeof d.exp !== "number" || d.exp < Date.now() / 1000) return null;
    return d as T;
  } catch {
    return null;
  }
}

/** Compara com o MCP_ANALISE_TOKEN em tempo constante. */
export function senhaCorreta(recebida: string) {
  const esperada = process.env.MCP_ANALISE_TOKEN ?? "";
  if (esperada.length < 32) return false;
  const a = createHash("sha256").update(recebida).digest();
  const b = createHash("sha256").update(esperada).digest();
  return timingSafeEqual(a, b);
}

/** Só os endereços de retorno dos conectores do Claude. */
export function retornoPermitido(uri: string) {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" && ["claude.ai", "claude.com"].includes(u.hostname);
  } catch {
    return false;
  }
}

export const origem = (req: Request) => new URL(req.url).origin;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export const json = (dados: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...extra },
  });

export const metadadosRecurso = (req: Request) =>
  json({
    resource: `${origem(req)}/api/mcp`,
    authorization_servers: [origem(req)],
    bearer_methods_supported: ["header"],
    resource_name: "Análise Hypnobox",
  });

export const metadadosServidor = (req: Request) => {
  const o = origem(req);
  return json({
    issuer: o,
    authorization_endpoint: `${o}/api/oauth/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    registration_endpoint: `${o}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["analise"],
  });
};

/** Registro dinâmico: aceita o Claude sem guardar nada (o client_id é só um rótulo). */
export async function registrar(req: Request) {
  const corpo = (await req.json().catch(() => ({}))) as {
    redirect_uris?: string[];
    client_name?: string;
  };
  const uris = Array.isArray(corpo.redirect_uris) ? corpo.redirect_uris : [];
  if (!uris.length || !uris.every(retornoPermitido))
    return json(
      { error: "invalid_redirect_uri", error_description: "Só conectores do Claude." },
      400,
    );
  return json(
    {
      client_id: `claude-${b64(randomBytes(12))}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: corpo.client_name ?? "Claude",
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function paginaAutorizar(campos: Record<string, string>, erro?: string) {
  const ocultos = Object.entries(campos)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autorizar o Claude · Análise Hypnobox</title>
<link href="https://fonts.googleapis.com/css2?family=Titillium+Web:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#F3F3F3;color:#2D2D2D;font-family:"Titillium Web",system-ui,sans-serif;padding:16px}
.c{width:100%;max-width:420px;background:#fff;border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.12);overflow:hidden}
.h{background:#2D2D2D;color:#fff;padding:18px 22px}.h small{display:block;color:#B28069;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:11px}.h b{font-size:20px}
form{padding:22px;display:grid;gap:14px}p{margin:0;line-height:1.5;font-size:15px}label{font-weight:600;font-size:14px;display:grid;gap:6px}
input[type=password]{height:44px;border:1px solid #ddd;border-radius:12px;padding:0 12px;font-size:15px;font-family:inherit}input:focus{outline:2px solid #B28069;border-color:#B28069}
button{height:46px;border:0;border-radius:12px;background:#2D2D2D;color:#fff;font-weight:700;font-size:15px;font-family:inherit;cursor:pointer}button:hover{background:#000}
.e{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:12px;padding:10px 12px;font-size:14px}.n{color:#737373;font-size:13px}</style></head>
<body><div class="c"><div class="h"><small>Sales Navigator</small><b>Autorizar o Claude</b></div>
<form method="post">${ocultos}
<p>O Claude quer <b>ler</b> a Análise Hypnobox: leads, visitas, mensagens e o dash da LEN, sem nome, e-mail ou telefone de clientes.</p>
${erro ? `<div class="e" role="alert">${esc(erro)}</div>` : ""}
<label>Senha do MCP<input type="password" name="senha" autocomplete="off" required autofocus></label>
<p class="n">É o valor de MCP_ANALISE_TOKEN (no .env e na Vercel).</p>
<button type="submit">Autorizar</button></form></div></body></html>`,
    {
      status: erro ? 401 : 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}

const CAMPOS_AUTORIZAR = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
];

/** GET mostra a página; POST confere a senha e devolve o código ao Claude. */
export async function autorizar(req: Request) {
  const dados: Record<string, string> = {};
  if (req.method === "POST") {
    const f = await req.formData();
    for (const k of [...CAMPOS_AUTORIZAR, "senha"]) dados[k] = String(f.get(k) ?? "");
  } else {
    const q = new URL(req.url).searchParams;
    for (const k of CAMPOS_AUTORIZAR) dados[k] = q.get(k) ?? "";
  }
  const { senha, ...campos } = dados;
  if (
    campos.response_type !== "code" ||
    !retornoPermitido(campos.redirect_uri) ||
    !campos.code_challenge ||
    (campos.code_challenge_method && campos.code_challenge_method !== "S256")
  )
    return new Response("Pedido de autorização inválido.", { status: 400 });
  if (req.method !== "POST") return paginaAutorizar(campos);
  if (!senhaCorreta(senha ?? "")) return paginaAutorizar(campos, "Senha incorreta.");
  const code = assinar(
    { typ: "code", cc: campos.code_challenge, ru: campos.redirect_uri, cid: campos.client_id },
    5 * 60,
  );
  const volta = new URL(campos.redirect_uri);
  volta.searchParams.set("code", code);
  if (campos.state) volta.searchParams.set("state", campos.state);
  return new Response(null, {
    status: 302,
    headers: { Location: volta.toString(), "Cache-Control": "no-store" },
  });
}

function parTokens() {
  return {
    access_token: assinar({ typ: "at" }, 30 * DIA),
    token_type: "Bearer",
    expires_in: 30 * DIA,
    refresh_token: assinar({ typ: "rt" }, 365 * DIA),
    scope: "analise",
  };
}

export async function emitirToken(req: Request) {
  const f = new URLSearchParams(await req.text());
  const tipo = f.get("grant_type");
  if (tipo === "authorization_code") {
    const c = verificar<{ cc: string; ru: string }>(f.get("code") ?? "", "code");
    const verifier = f.get("code_verifier") ?? "";
    const desafio = b64(createHash("sha256").update(verifier).digest());
    if (
      !c ||
      !verifier ||
      desafio !== c.cc ||
      (f.get("redirect_uri") && f.get("redirect_uri") !== c.ru)
    )
      return json({ error: "invalid_grant" }, 400);
    return json(parTokens());
  }
  if (tipo === "refresh_token") {
    if (!verificar(f.get("refresh_token") ?? "", "rt"))
      return json({ error: "invalid_grant" }, 400);
    return json(parTokens());
  }
  return json({ error: "unsupported_grant_type" }, 400);
}

/** Atende o MCP sem sessão (a Vercel não guarda estado entre chamadas). */
export async function atenderMcp(req: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await criarServidorAnalise().connect(transport);
  const res = await transport.handleRequest(req);
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/** MCP protegido pelo token do OAuth (Authorization: Bearer ...). */
export async function atenderMcpComLogin(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verificar(token, "at"))
    return json({ error: "invalid_token" }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${origem(req)}/.well-known/oauth-protected-resource"`,
    });
  return atenderMcp(req);
}
