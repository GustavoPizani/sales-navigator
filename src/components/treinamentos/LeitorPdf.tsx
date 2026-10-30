import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";

// Leitor de PDF da biblioteca, como o do Conx Academy: uma página por vez, com
// zoom, setas do teclado e a última página lida guardada neste navegador.

const MAX_PIXELS = 16_000_000;
const chave = (id: string) => `treinamentos:pagina:${id}`;

function lerPagina(id: string) {
  try {
    const n = Number(localStorage.getItem(chave(id)));
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

export function LeitorPdf({
  id,
  titulo,
  url,
  onClose,
}: {
  id: string;
  titulo: string;
  url: string;
  onClose: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [doc, setDoc] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pagina, setPagina] = useState(() => lerPagina(id));
  const [zoom, setZoom] = useState(1);
  const [desenhando, setDesenhando] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const total = doc?.numPages ?? 0;

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
        const d = await pdfjsLib.getDocument(url).promise;
        if (cancelado) return;
        setDoc(d);
        setPagina((p) => Math.min(p, d.numPages));
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Não foi possível abrir o PDF.");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [url]);

  // desenha só a página atual (PDFs de 100+ páginas abrem na hora)
  useEffect(() => {
    if (!doc) return;
    let cancelado = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tarefa: any = null;
    (async () => {
      setDesenhando(true);
      try {
        const page = await doc.getPage(pagina);
        const area = areaRef.current;
        const canvas = canvasRef.current;
        if (cancelado || !area || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        // cabe inteira na tela (largura e altura); o zoom aumenta a partir daí
        const caber = Math.min(
          (area.clientWidth - 16) / base.width,
          (area.clientHeight - 16) / base.height,
        );
        const largura = base.width * caber * zoom;
        const dpr = window.devicePixelRatio || 1;
        let escala = (largura / base.width) * dpr;
        const px = base.width * base.height * escala * escala;
        if (px > MAX_PIXELS) escala *= Math.sqrt(MAX_PIXELS / px);
        const vp = page.getViewport({ scale: escala });
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${largura}px`;
        canvas.style.height = `${(largura * base.height) / base.width}px`;
        tarefa = page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp });
        await tarefa.promise;
      } catch {
        /* página trocada no meio do desenho */
      } finally {
        if (!cancelado) setDesenhando(false);
      }
    })();
    try {
      localStorage.setItem(chave(id), String(pagina));
    } catch {
      /* navegador sem armazenamento */
    }
    return () => {
      cancelado = true;
      tarefa?.cancel?.();
    };
  }, [doc, pagina, zoom, id]);

  const ir = useCallback(
    (d: number) => setPagina((p) => Math.max(1, Math.min(total || 1, p + d))),
    [total],
  );

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") ir(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") ir(-1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ir, onClose]);

  // deslizar o dedo para os lados troca de página (sem zoom)
  const toque = useRef<number | null>(null);

  const botao =
    "h-10 w-10 grid place-items-center rounded-lg text-white/90 hover:bg-white/10 disabled:opacity-30";
  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="flex items-center gap-1 px-2 py-2 text-white">
        <button type="button" onClick={onClose} className={botao} aria-label="Fechar o leitor">
          <X size={20} aria-hidden />
        </button>
        <p className="flex-1 min-w-0 truncate text-sm font-semibold">{titulo}</p>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
          disabled={zoom <= 1}
          className={botao}
          aria-label="Diminuir o zoom"
        >
          <ZoomOut size={18} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          disabled={zoom >= 3}
          className={botao}
          aria-label="Aumentar o zoom"
        >
          <ZoomIn size={18} aria-hidden />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          download
          className={botao}
          aria-label="Baixar o PDF"
        >
          <Download size={18} aria-hidden />
        </a>
      </div>

      <div
        ref={areaRef}
        className="relative flex-1 overflow-auto grid place-items-center"
        onTouchStart={(e) => (toque.current = zoom === 1 ? e.touches[0].clientX : null)}
        onTouchEnd={(e) => {
          if (toque.current == null) return;
          const dx = e.changedTouches[0].clientX - toque.current;
          if (Math.abs(dx) > 60) ir(dx < 0 ? 1 : -1);
          toque.current = null;
        }}
      >
        {erro ? (
          <p className="text-white/80 text-sm px-6 text-center">
            {erro}{" "}
            <a href={url} target="_blank" rel="noreferrer" className="underline">
              Abrir o PDF em outra aba
            </a>
          </p>
        ) : !doc ? (
          <Loader2 size={32} className="animate-spin text-white/70" aria-label="Carregando o PDF" />
        ) : (
          <canvas ref={canvasRef} className="bg-white shadow-2xl" />
        )}
        {doc && desenhando && (
          <Loader2
            size={20}
            className="absolute top-3 right-3 animate-spin text-white/60"
            aria-hidden
          />
        )}
      </div>

      {doc && (
        <div className="flex items-center justify-center gap-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-white">
          <button
            type="button"
            onClick={() => ir(-1)}
            disabled={pagina <= 1}
            className={botao}
            aria-label="Página anterior"
          >
            <ChevronLeft size={22} aria-hidden />
          </button>
          <label className="text-sm tabular-nums inline-flex items-center gap-1.5">
            <span className="sr-only">Página</span>
            <input
              type="number"
              min={1}
              max={total}
              value={pagina}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= total) setPagina(n);
              }}
              className="w-14 h-8 rounded-md bg-white/10 text-center text-white"
            />
            de {total}
          </label>
          <button
            type="button"
            onClick={() => ir(1)}
            disabled={pagina >= total}
            className={botao}
            aria-label="Próxima página"
          >
            <ChevronRight size={22} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
