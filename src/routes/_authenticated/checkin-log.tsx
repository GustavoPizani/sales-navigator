import { createFileRoute } from "@tanstack/react-router";
import { CheckinLog } from "@/components/checkin/CheckinLog";
import { RequireModule } from "@/components/RequireModule";

export const Route = createFileRoute("/_authenticated/checkin-log")({
  component: CheckinLogGuarded,
});

// Visível somente para ADM e RH (fixo, fora da matriz de permissões).
// O ADM também abre o log pela aba da tela de Check-in.
function CheckinLogGuarded() {
  return (
    <RequireModule checkinLog>
      <CheckinLog />
    </RequireModule>
  );
}
