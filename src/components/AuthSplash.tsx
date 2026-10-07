import { Loader2 } from "lucide-react";

/** Tela de espera enquanto a sessão salva é conferida (em vez do formulário de login). */
export function AuthSplash() {
  return (
    <div
      className="h-screen flex flex-col items-center justify-center gap-6"
      style={{ background: "#1E1E1E" }}
    >
      <img
        src="/logo-paes-gregori.webp"
        alt="Paes & Gregori"
        style={{ width: 180, height: "auto", filter: "brightness(0) invert(1)" }}
      />
      <Loader2 className="animate-spin" size={26} color="#B28069" />
    </div>
  );
}
