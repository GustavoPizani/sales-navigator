import { useEffect, useState } from "react";
import { MonitorSmartphone, X } from "lucide-react";

/**
 * Celular com o Chrome em "Site para computador": a página é desenhada com
 * ~980 px de largura e tudo fica pequeno, "afastado". O app não consegue
 * desligar isso; o aviso explica como a pessoa desliga no próprio Chrome.
 */
function emModoComputador() {
  const toque = navigator.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches;
  const telaDeCelular = Math.min(window.screen.width, window.screen.height) <= 600;
  return toque && telaDeCelular && window.innerWidth >= 900;
}

export function AvisoModoComputador() {
  const [ativo, setAtivo] = useState(false);
  const [fechado, setFechado] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const checar = () => setAtivo(emModoComputador());
    checar();
    window.addEventListener("resize", checar);
    return () => window.removeEventListener("resize", checar);
  }, []);
  if (!ativo || fechado) return null;
  // letra grande de propósito: a página está "afastada" e o texto normal ficaria minúsculo
  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[60] bg-amber-50 border-b-2 border-amber-300 text-amber-950 px-6 py-5 shadow-lg flex items-start gap-4"
    >
      <MonitorSmartphone size={40} className="flex-shrink-0 text-amber-700" aria-hidden />
      <div className="flex-1 text-2xl leading-snug">
        <p className="font-bold mb-1">A tela está pequena porque o Chrome está no modo computador.</p>
        <p>
          Toque nos três pontinhos (⋮) no canto de cima do Chrome e desmarque{" "}
          <b>"Site para computador"</b>. A página volta ao tamanho normal.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setFechado(true)}
        className="h-14 w-14 flex items-center justify-center rounded-xl text-amber-800 hover:bg-amber-100"
        aria-label="Fechar aviso"
      >
        <X size={32} />
      </button>
    </div>
  );
}
