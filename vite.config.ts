// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// noExternal: true is needed for production (bundles React into SSR output for Vercel).
// In dev, Vite 7's ESM module runner can't evaluate CJS modules (react/index.js uses
// module.exports), so we skip noExternal and let Node.js load React natively.
const isBuild = process.env.NODE_ENV === "production";

// pdfjs-dist optionally imports "canvas" (a Node-only native rendering fallback we
// never exercise). It isn't installed, and a bare `import "canvas"` can't resolve in
// the browser at all — alias it to an empty stub for every environment instead of
// trying to externalize it (which only works for Node and crashes the client bundle).
const canvasStubAlias = {
  canvas: fileURLToPath(new URL("./src/shims/canvas-stub.ts", import.meta.url)),
};

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    serverFns: {
      disableCsrfMiddlewareWarning: true,
    },
  },
  vite: {
    resolve: { alias: canvasStubAlias },
    // o CORS do servidor de desenvolvimento respondia ao preflight antes das rotas
    // (/api/ext e /api/mcp têm CORS próprio): desligado, o local se comporta como a Vercel
    server: { cors: false },
    // o pdfjs-dist só é importado sob demanda (leitor e capas): pré-empacotado na
    // largada, o Vite não o reempacota com a página aberta (o que quebrava o import)
    optimizeDeps: { include: ["pdfjs-dist"] },
    ...(isBuild ? { ssr: { noExternal: true } } : {}),
  },
});
