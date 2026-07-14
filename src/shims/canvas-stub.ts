// pdfjs-dist optionally imports "canvas" as a Node-only rendering fallback,
// which we never actually exercise (we only extract text or render into a
// real browser <canvas> element). "canvas" isn't installed as a dependency
// (it requires native compilation), and a bare `import "canvas"` can't be
// resolved in the browser at all. vite.config.ts aliases "canvas" to this
// empty stub for both the client and SSR builds so the import always
// resolves to *something* without pulling in the real native module.
export default {};
