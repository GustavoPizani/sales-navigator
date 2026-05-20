import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const out = join(root, '.vercel', 'output');

if (existsSync(out)) rmSync(out, { recursive: true });

mkdirSync(join(out, 'static'), { recursive: true });
mkdirSync(join(out, 'functions', 'index.func', 'dist'), { recursive: true });

// Ativos estáticos do cliente (servidos pelo CDN do Vercel)
cpSync(join(root, 'dist', 'client'), join(out, 'static'), { recursive: true });

// O Servidor SSR precisa de ambos (Client e Server) disponíveis em tempo de execução
// para ler o index.html e renderizar as rotas corretamente.
cpSync(join(root, 'dist', 'server'), join(out, 'functions', 'index.func', 'dist', 'server'), { recursive: true });
cpSync(join(root, 'dist', 'client'), join(out, 'functions', 'index.func', 'dist', 'client'), { recursive: true });

// Adaptador Node.js: converte Node.js req/res ↔ Web API Request/Response
writeFileSync(
  join(out, 'functions', 'index.func', 'index.js'),
  `import server from './dist/server/server.js';

async function toWebRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, \`\${proto}://\${host}\`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
  }

  let body = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length > 0) body = Buffer.concat(chunks);
  }

  return new Request(url.toString(), { method: req.method, headers, body });
}

export default async function handler(req, res) {
  try {
    const webRequest = await toWebRequest(req);
    const webResponse = await server.fetch(webRequest, process.env, {});

    res.statusCode = webResponse.status;
    for (const [key, value] of webResponse.headers) {
      res.setHeader(key, value);
    }

    const buffer = await webResponse.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error('SSR error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}
`
);

// package.json so Node.js treats the function dir as ESM
writeFileSync(
  join(out, 'functions', 'index.func', 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2)
);

// Vercel Node.js serverless function config
writeFileSync(
  join(out, 'functions', 'index.func', '.vc-config.json'),
  JSON.stringify({
    runtime: 'nodejs20.x',
    handler: 'index.js',
    launcherType: 'Nodejs',
  }, null, 2)
);

// Routing: static assets first, then SSR catch-all
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify({
    version: 3,
    routes: [
      {
        src: '/assets/(.*)',
        headers: { 'cache-control': 'public, max-age=31536000, immutable' },
        continue: true,
      },
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index' },
    ],
  }, null, 2)
);

console.log('Vercel output built at .vercel/output/');
