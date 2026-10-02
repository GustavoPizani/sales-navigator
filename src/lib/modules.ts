// Módulos do sistema usados na matriz de permissões (Cargo x Módulo).
// A matriz define QUAIS MÓDULOS o cargo acessa; a equipe e o tipo do cargo
// definem QUAIS DADOS ele vê dentro deles (regras no banco).

export type ModuleKey =
  | "dashboard"
  | "leads"
  | "schedule"
  | "checkin"
  | "appointments"
  | "projects"
  | "team";
export type PermissionLevel = "hidden" | "view" | "edit";

export const MODULES: { key: ModuleKey; label: string; description: string }[] = [
  { key: "dashboard", label: "Dashboard", description: "Gráficos, KPIs e desempenho por corretor" },
  { key: "leads", label: "Atendimentos", description: "Leads: Kanban, planilha e página do lead" },
  { key: "schedule", label: "Escala", description: "Escala de plantão e vagas" },
  {
    key: "checkin",
    label: "Check-in",
    description: "Check-in da roleta e acompanhamento do turno",
  },
  { key: "appointments", label: "Agendamentos", description: "Agenda de visitas e compromissos" },
  { key: "projects", label: "Imóveis", description: "Catálogo de imóveis e documentos" },
  { key: "team", label: "Time", description: "Equipes, gerentes e corretores" },
];

export const LEVEL_LABEL: Record<PermissionLevel, string> = {
  hidden: "Oculto",
  view: "Somente visualização",
  edit: "Visualização e edição",
};

export const BASE_ROLE_LABEL: Record<string, string> = {
  admin: "ADM (acesso total)",
  director: "ADM (acesso total)",
  master: "Gestor — vê a própria equipe",
  broker: "Corretor — vê só os próprios dados",
  hr: "RH — sem acesso a leads",
};

/** Permissões padrão por tipo de cargo (usadas enquanto a matriz não carrega). */
export const DEFAULT_LEVELS: Record<string, Record<ModuleKey, PermissionLevel>> = {
  master: {
    dashboard: "view",
    leads: "edit",
    schedule: "edit",
    checkin: "view",
    appointments: "edit",
    projects: "view",
    team: "edit",
  },
  broker: {
    dashboard: "view",
    leads: "edit",
    schedule: "edit",
    checkin: "edit",
    appointments: "edit",
    projects: "view",
    team: "hidden",
  },
  hr: {
    dashboard: "hidden",
    leads: "hidden",
    schedule: "hidden",
    checkin: "hidden",
    appointments: "hidden",
    projects: "hidden",
    team: "hidden",
  },
};

/** Rota de cada módulo no menu. */
export const MODULE_ROUTE: Record<ModuleKey, string> = {
  dashboard: "/dashboard",
  leads: "/dashboard",
  schedule: "/schedule",
  checkin: "/checkin",
  appointments: "/calendar",
  projects: "/projects",
  team: "/team",
};
