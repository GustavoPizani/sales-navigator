import { createFileRoute } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { useState } from "react";
import { QrCode, Radar, Settings2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { BrokerCheckin } from "@/components/checkin/BrokerCheckin";
import { CheckinQr } from "@/components/checkin/CheckinQr";
import { CheckinRules } from "@/components/checkin/CheckinRules";
import { TurnMonitor } from "@/components/checkin/TurnMonitor";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/checkin")({
  component: CheckinPageGuarded,
});

// Rota bloqueada pela matriz de permissões do cargo.
function CheckinPageGuarded() {
  return (
    <RequireModule modules={["checkin"]}>
      <CheckinPage />
    </RequireModule>
  );
}

type Tab = "monitor" | "qr" | "rules";

// Check-in da roleta:
//   corretor → faz o check-in (GPS; pelo app ou escaneando o QR code) e acompanha o status;
//   gerente  → acompanha os check-ins da equipe e mostra o QR code;
//   admin    → acompanha todos os turnos, decide vagas, gera o QR code e configura as regras.
function CheckinPage() {
  const { profile, isSuperAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>("monitor");
  const isBroker = profile?.role === "broker";

  const tabs: [Tab, string, React.ElementType][] = [
    ["monitor", "Acompanhamento do turno", Radar],
    ["qr", "QR code", QrCode],
    ...(isSuperAdmin
      ? ([["rules", "Regras de check-in", Settings2]] as [Tab, string, React.ElementType][])
      : []),
  ];

  return (
    <div className="pb-nav">
      <AppHeader title="Check-in" />
      <div className="px-4 pt-4 max-w-4xl mx-auto space-y-3">
        {isBroker ? (
          <BrokerCheckin />
        ) : (
          <>
            <div
              className="inline-flex flex-wrap rounded-lg border border-border bg-white p-0.5"
              role="tablist"
            >
              {tabs.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`h-9 px-3 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${
                    tab === key ? "bg-[var(--navy)] text-white" : "text-muted-foreground"
                  }`}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            {tab === "rules" && isSuperAdmin ? (
              <CheckinRules />
            ) : tab === "qr" ? (
              <CheckinQr />
            ) : (
              <TurnMonitor canDecide={isSuperAdmin} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
