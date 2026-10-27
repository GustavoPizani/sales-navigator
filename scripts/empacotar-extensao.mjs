// Monta a extensão do WhatsApp a partir de extensao/.
//
//   node scripts/empacotar-extensao.mjs
//
// Gera:
//   extensao/dist/gestao-whatsapp/        pasta para "Carregar sem compactação" (produção + servidor local)
//   public/extensao/gestao-whatsapp.zip   o que a página /extensao oferece para baixar (só produção)
//
// Usa do .env só valores públicos (VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY,
// que já vão no site). A chave pública do manifesto fixa o ID da extensão; ela
// fica em extensao/chave-publica.txt (a privada não é necessária e não é guardada).
import { createHash, generateKeyPairSync } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(RAIZ, "extensao");
const PASTA = join(SRC, "dist", "gestao-whatsapp");
const ZIP = join(RAIZ, "public", "extensao", "gestao-whatsapp.zip");
const PRODUCAO = "https://gerenciadorequipespeg.vercel.app";
const LOCAL = "http://localhost:8090";

const env = Object.fromEntries(
  readFileSync(join(RAIZ, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Faltam VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env");

// chave pública fixa → ID fixo da extensão
const arqChave = join(SRC, "chave-publica.txt");
if (!existsSync(arqChave)) {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(arqChave, publicKey.export({ type: "spki", format: "der" }).toString("base64") + "\n");
}
const chave = readFileSync(arqChave, "utf8").trim();
const idExtensao = [...createHash("sha256").update(Buffer.from(chave, "base64")).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");

const base = JSON.parse(readFileSync(join(SRC, "manifest.base.json"), "utf8"));
const versaoApi = /VERSAO_EXTENSAO = "([^"]+)"/.exec(readFileSync(join(RAIZ, "src/lib/extensao/api.server.ts"), "utf8"))?.[1];
if (versaoApi !== base.version)
  console.warn(`ATENÇÃO: manifest.base.json (${base.version}) e VERSAO_EXTENSAO da API (${versaoApi}) diferentes.`);

function montar(servidores) {
  const manifest = {
    ...base,
    key: chave,
    host_permissions: ["https://web.whatsapp.com/*", `${supabaseUrl}/*`, ...servidores.map((s) => `${s.url}/*`)],
    content_scripts: [
      ...base.content_scripts,
      // nas páginas do sistema: avisa qual conta está logada (entrada automática da faixa)
      { matches: servidores.map((s) => `${s.url}/*`), js: ["sessao-sistema.js"], run_at: "document_idle" },
    ],
  };
  const config = `// gerado por scripts/empacotar-extensao.mjs\nwindow.GC_CONFIG = ${JSON.stringify(
    { supabaseUrl, supabaseKey, servidores },
    null,
    2,
  )};\n`;
  const ler = (f) => readFileSync(join(SRC, f));
  return {
    "manifest.json": Buffer.from(JSON.stringify(manifest, null, 2)),
    "config.js": Buffer.from(config),
    "content.js": ler("content.js"),
    "ponte.js": ler("ponte.js"),
    "sessao-sistema.js": ler("sessao-sistema.js"),
    "painel.html": ler("painel.html"),
    "painel.css": ler("painel.css"),
    "painel.js": ler("painel.js"),
    "background.js": ler("background.js"),
    "icone.png": readFileSync(join(RAIZ, "public", "icon-192.png")),
    "wppconnect-wa.js": readFileSync(join(RAIZ, "node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js")),
    "LICENSE-wa-js.txt": readFileSync(join(RAIZ, "node_modules/@wppconnect/wa-js/LICENSE")),
  };
}

// ZIP simples (deflate), com tudo dentro da pasta gestao-whatsapp/
function zipar(arquivos, prefixo) {
  const partes = [];
  const central = [];
  let offset = 0;
  for (const [nome, dados] of Object.entries(arquivos)) {
    const n = Buffer.from(prefixo + nome);
    const comp = deflateRawSync(dados, { level: 9 });
    const crc = crc32(dados);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    loc.writeUInt16LE(8, 8);
    loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(dados.length, 22);
    loc.writeUInt16LE(n.length, 26);
    partes.push(loc, n, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(dados.length, 24);
    cen.writeUInt16LE(n.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, n);
    offset += loc.length + n.length + comp.length;
  }
  const tamCentral = central.reduce((a, b) => a + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(tamCentral, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, ...central, fim]);
}

// pasta para testar (produção + local)
rmSync(PASTA, { recursive: true, force: true });
mkdirSync(PASTA, { recursive: true });
for (const [nome, dados] of Object.entries(
  montar([
    { nome: "Produção", url: PRODUCAO },
    { nome: "Local (teste)", url: LOCAL },
  ]),
))
  writeFileSync(join(PASTA, nome), dados);

// ZIP para os corretores (só produção)
mkdirSync(dirname(ZIP), { recursive: true });
writeFileSync(ZIP, zipar(montar([{ nome: "Produção", url: PRODUCAO }]), "gestao-whatsapp/"));

console.log(`Extensão ${base.version} · ID ${idExtensao}`);
console.log(`Pasta para testar: ${PASTA}`);
console.log(`ZIP: ${ZIP} (${Math.round(readFileSync(ZIP).length / 1024)} KB)`);
