// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// noExternal: true is needed for production (bundles React into SSR output for Vercel).
// In dev, Vite 7's ESM module runner can't evaluate CJS modules (react/index.js uses
// module.exports), so we skip noExternal and let Node.js load React natively.
const isBuild = process.env.NODE_ENV === "production";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    serverFns: {
      disableCsrfMiddlewareWarning: true,
    },
  },
  ...(isBuild
    ? {
        vite: {
          ssr: { noExternal: true },
          // pdfjs-dist optionally imports "canvas" (Node canvas rendering fallback),
          // which isn't installed as a dependency — keep it external so SSR build
          // doesn't try to bundle/resolve it.
          build: {
            rollupOptions: {
              external: ["canvas"],
            },
          },
        },
      }
    : {}),
});
