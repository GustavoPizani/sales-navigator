import { useEffect, useState } from "react";
import { Loader2, MapPin, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import { getPosition } from "@/hooks/useRoulette";

type PermState = "granted" | "prompt" | "denied" | "unknown";

function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

const DENIED_STEPS: Record<string, string[]> = {
  ios: [
    "Abra Ajustes do iPhone → Privacidade e Segurança → Serviços de Localização e deixe ativado.",
    "Na mesma tela, toque em Safari (ou no app da Tela de Início) e escolha “Ao Usar o App”.",
    "Volte aqui e toque em “Ativar localização”.",
  ],
  android: [
    "Puxe a barra de cima do celular e ative a Localização.",
    "No Chrome, toque no cadeado ao lado do endereço → Permissões → Localização → Permitir.",
    "Volte aqui e toque em “Ativar localização”.",
  ],
  desktop: [
    "Clique no cadeado ao lado do endereço do site → Localização → Permitir.",
    "Recarregue a página e toque em “Ativar localização”.",
  ],
};

/**
 * Pede a localização antes do check-in: explica por que, dispara o pedido do
 * navegador e, se ele foi negado, mostra como liberar no aparelho.
 */
export function LocationPermission({ required }: { required: boolean }) {
  const [state, setState] = useState<PermState>("unknown");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let status: PermissionStatus | null = null;
    const nav = navigator as Navigator & { permissions?: Permissions };
    if (!nav.permissions?.query) return;
    nav.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((s) => {
        status = s;
        setState(s.state as PermState);
        s.onchange = () => setState(s.state as PermState);
      })
      .catch(() => setState("unknown"));
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  if (!required || state === "granted") return null;

  const ask = async () => {
    setAsking(true);
    try {
      await getPosition();
      setState("granted");
      toast.success("Localização liberada!");
    } catch (e: any) {
      setState("denied");
      toast.error(e.message);
    } finally {
      setAsking(false);
    }
  };

  const denied = state === "denied";
  return (
    <div
      className={`rounded-2xl border p-4 ${denied ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${denied ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}
        >
          {denied ? <ShieldAlert size={20} /> : <MapPin size={20} />}
        </div>
        <div className="min-w-0">
          <h3 className={`font-bold ${denied ? "text-red-700" : "text-amber-800"}`}>
            {denied ? "Localização bloqueada" : "Libere sua localização"}
          </h3>
          <p className={`text-xs mt-0.5 ${denied ? "text-red-700/80" : "text-amber-800/80"}`}>
            O check-in deste turno confere se você está no local do plantão. Sua localização só é
            usada no momento do check-in.
          </p>
          {denied && (
            <ol className="mt-2 space-y-1 text-xs text-red-700 list-decimal pl-4">
              {DENIED_STEPS[deviceKind()].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={ask}
        disabled={asking}
        className={`mt-3 w-full h-11 rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 ${denied ? "bg-red-600" : "bg-amber-600"}`}
      >
        {asking ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
        Ativar localização
      </button>
    </div>
  );
}
