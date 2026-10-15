import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Cloud, Minus } from "lucide-react";

// Janela flutuante ("nuvem") por cima da página: arrasta pelo cabeçalho,
// redimensiona pelas bordas e cantos, minimiza, e lembra posição e tamanho.
// No celular vira uma folha presa embaixo (sem arrastar).

type Geo = { x: number; y: number; w: number; h: number };
type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_W = 340;
const MIN_H = 280;
const MARGEM = 8;

function padrao(): Geo {
  const w = Math.min(460, window.innerWidth - 2 * MARGEM);
  const h = Math.min(680, window.innerHeight - 120);
  return { x: window.innerWidth - w - 24, y: 80, w, h };
}

function encaixar(g: Geo): Geo {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(g.w, MIN_W), vw - 2 * MARGEM);
  const h = Math.min(Math.max(g.h, MIN_H), vh - 2 * MARGEM);
  return {
    w,
    h,
    x: Math.min(Math.max(g.x, MARGEM), vw - w - MARGEM),
    y: Math.min(Math.max(g.y, MARGEM), vh - 56),
  };
}

function lerSalvo(chave: string): { geo: Geo; min: boolean } | null {
  try {
    const s = JSON.parse(localStorage.getItem(chave) || "null");
    if (s && typeof s.geo?.x === "number") return { geo: encaixar(s.geo), min: Boolean(s.min) };
  } catch {
    /* sem storage */
  }
  return null;
}

const ALCAS: { dir: Dir; cls: string; cursor: string }[] = [
  { dir: "n", cls: "top-0 left-3 right-3 h-1.5 -translate-y-1/2", cursor: "ns-resize" },
  { dir: "s", cls: "bottom-0 left-3 right-3 h-1.5 translate-y-1/2", cursor: "ns-resize" },
  { dir: "e", cls: "right-0 top-3 bottom-3 w-1.5 translate-x-1/2", cursor: "ew-resize" },
  { dir: "w", cls: "left-0 top-3 bottom-3 w-1.5 -translate-x-1/2", cursor: "ew-resize" },
  {
    dir: "ne",
    cls: "right-0 top-0 h-3 w-3 translate-x-1/2 -translate-y-1/2",
    cursor: "nesw-resize",
  },
  {
    dir: "sw",
    cls: "left-0 bottom-0 h-3 w-3 -translate-x-1/2 translate-y-1/2",
    cursor: "nesw-resize",
  },
  {
    dir: "nw",
    cls: "left-0 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2",
    cursor: "nwse-resize",
  },
  {
    dir: "se",
    cls: "right-0 bottom-0 h-3 w-3 translate-x-1/2 translate-y-1/2",
    cursor: "nwse-resize",
  },
];

export function NuvemFlutuante({
  chave,
  titulo,
  status,
  resumoMinimizado,
  children,
}: {
  /** Chave do localStorage para posição, tamanho e minimizado. */
  chave: string;
  titulo: string;
  /** Selo no cabeçalho (ex.: conexão com o extrator). */
  status?: ReactNode;
  /** Texto curto mostrado quando minimizada (ex.: progresso). */
  resumoMinimizado?: string;
  children: ReactNode;
}) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [min, setMin] = useState(false);
  const [celular, setCelular] = useState(false);
  const geoRef = useRef<Geo | null>(null);
  geoRef.current = geo;

  useEffect(() => {
    const salvo = lerSalvo(chave);
    setGeo(salvo?.geo ?? padrao());
    setMin(salvo?.min ?? false);
    const medir = () => {
      setCelular(window.innerWidth < 640);
      setGeo((g) => (g ? encaixar(g) : g));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [chave]);

  const salvar = useCallback(
    (g: Geo | null, m: boolean) => {
      try {
        if (g) localStorage.setItem(chave, JSON.stringify({ geo: g, min: m }));
      } catch {
        /* sem storage: vale só nesta visita */
      }
    },
    [chave],
  );

  const alternarMin = (m: boolean) => {
    setMin(m);
    salvar(geoRef.current, m);
  };

  // arrastar / redimensionar com ponteiro (mouse, toque e caneta)
  const iniciar = (e: React.PointerEvent, dir: Dir | "mover") => {
    if (celular || !geoRef.current) return;
    if (dir === "mover" && (e.target as HTMLElement).closest("button, a, input, select")) return;
    e.preventDefault();
    const alvo = e.currentTarget as HTMLElement;
    alvo.setPointerCapture(e.pointerId);
    const ini = { px: e.clientX, py: e.clientY, g: geoRef.current };
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - ini.px;
      const dy = ev.clientY - ini.py;
      const g = { ...ini.g };
      if (dir === "mover") {
        g.x += dx;
        g.y += dy;
      } else {
        if (dir.includes("e")) g.w = ini.g.w + dx;
        if (dir.includes("s")) g.h = ini.g.h + dy;
        if (dir.includes("w")) {
          g.w = Math.max(MIN_W, ini.g.w - dx);
          g.x = ini.g.x + (ini.g.w - g.w);
        }
        if (dir.includes("n")) {
          g.h = Math.max(MIN_H, ini.g.h - dy);
          g.y = ini.g.y + (ini.g.h - g.h);
        }
      }
      setGeo(encaixar(g));
    };
    const soltar = () => {
      alvo.removeEventListener("pointermove", mover);
      alvo.removeEventListener("pointerup", soltar);
      alvo.removeEventListener("pointercancel", soltar);
      salvar(geoRef.current, false);
    };
    alvo.addEventListener("pointermove", mover);
    alvo.addEventListener("pointerup", soltar);
    alvo.addEventListener("pointercancel", soltar);
  };

  // teclado: setas movem, Shift + setas mudam o tamanho
  const teclado = (e: React.KeyboardEvent) => {
    if (celular || !geoRef.current) return;
    const passo = e.altKey ? 4 : 24;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-passo, 0],
      ArrowRight: [passo, 0],
      ArrowUp: [0, -passo],
      ArrowDown: [0, passo],
    };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    const g = { ...geoRef.current };
    if (e.shiftKey) {
      g.w += v[0];
      g.h += v[1];
    } else {
      g.x += v[0];
      g.y += v[1];
    }
    const novo = encaixar(g);
    setGeo(novo);
    salvar(novo, false);
  };

  if (!geo) return null;

  if (min)
    return (
      <button
        type="button"
        onClick={() => alternarMin(false)}
        className="fixed z-[60] flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-full bg-[var(--navy)] py-2.5 pl-3 pr-4 text-sm font-semibold text-white shadow-[0_12px_32px_rgba(0,0,0,0.3)] ring-1 ring-white/10 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] motion-reduce:transition-none"
        style={celular ? { left: 8, bottom: 8 } : { left: geo.x, top: geo.y }}
        aria-label={`Abrir ${titulo}`}
      >
        <Cloud size={18} className="flex-shrink-0 text-[var(--gold)]" aria-hidden />
        <span className="truncate">{resumoMinimizado || titulo}</span>
      </button>
    );

  return (
    <section
      role="dialog"
      aria-label={titulo}
      className={`fixed z-[60] flex flex-col overflow-hidden border border-black/10 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.28)] ${
        celular ? "inset-x-0 bottom-0 h-[75dvh] rounded-t-3xl" : "rounded-2xl"
      }`}
      style={celular ? undefined : { left: geo.x, top: geo.y, width: geo.w, height: geo.h }}
    >
      <header
        onPointerDown={(e) => iniciar(e, "mover")}
        onKeyDown={teclado}
        tabIndex={celular ? -1 : 0}
        aria-label={`${titulo}. Setas movem a janela; Shift + setas mudam o tamanho.`}
        className={`flex h-12 flex-shrink-0 select-none items-center gap-2 bg-[var(--navy)] pl-4 pr-1.5 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)] ${
          celular ? "" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <Cloud size={18} className="flex-shrink-0 text-[var(--gold)]" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{titulo}</h2>
        {status}
        <button
          type="button"
          onClick={() => alternarMin(true)}
          className="grid h-9 w-9 place-items-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
          aria-label="Minimizar"
          title="Minimizar"
        >
          <Minus size={18} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {!celular &&
        ALCAS.map((a) => (
          <div
            key={a.dir}
            aria-hidden
            onPointerDown={(e) => iniciar(e, a.dir)}
            className={`absolute z-10 touch-none ${a.cls}`}
            style={{ cursor: a.cursor }}
          />
        ))}
    </section>
  );
}
