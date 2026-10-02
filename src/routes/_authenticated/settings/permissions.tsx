import { createFileRoute } from "@tanstack/react-router";
import { RequireModule } from "@/components/RequireModule";
import { PermissionsPanel } from "@/components/team/PermissionsPanel";

export const Route = createFileRoute("/_authenticated/settings/permissions")({
  component: PermissionsGuarded,
});

// Somente o ADM acessa (fixo, fora da matriz). Também fica na subaba
// "Permissões" da tela Time.
function PermissionsGuarded() {
  return (
    <RequireModule adminOnly>
      <PermissionsPanel />
    </RequireModule>
  );
}
