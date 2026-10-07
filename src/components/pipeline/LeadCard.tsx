import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { CalendarIcon, Mail, MessageCircle, Phone } from "lucide-react";
import { initials, temperaturaStyles, whatsappUrl, type Lead } from "@/hooks/useLeads";

/** Card do lead no modelo do Real Sales (ClientCardContent), com a paleta navy/gold. */
export function LeadCard({ lead, isDragging = false }: { lead: Lead; isDragging?: boolean }) {
  const openWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(whatsappUrl(lead.phone!), "_blank");
  };

  return (
    <Link
      to="/leads/$leadId"
      params={{ leadId: lead.id }}
      draggable={false}
      className={`group block bg-white border border-border rounded-[14px] overflow-hidden shadow-[0_2px_8px_rgba(45,45,45,0.08)] hover:shadow-[0_4px_14px_rgba(45,45,45,0.14)] transition-shadow ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="h-1 w-full bg-gradient-to-r from-[var(--gold)] via-[var(--gold)]/60 to-transparent" />
      <div className="p-3.5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
            style={{ background: "linear-gradient(135deg, var(--gold), var(--gold-dark))" }}
          >
            {initials(lead.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[var(--navy)] text-sm leading-tight truncate">
              {lead.full_name}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <CalendarIcon className="h-2.5 w-2.5" />
              {format(new Date(lead.created_at), "dd/MM/yy")}
              {lead.client_code && (
                <span className="whitespace-nowrap">· ID {lead.client_code}</span>
              )}
              {lead.project && <span className="truncate">· {lead.project.name}</span>}
            </p>
          </div>
          {lead.phone && (
            <button
              type="button"
              onClick={openWhatsApp}
              aria-label="Abrir WhatsApp"
              className="h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 hover:bg-green-500/15 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            >
              <MessageCircle className="h-3.5 w-3.5 text-green-600" />
            </button>
          )}
        </div>

        {(lead.phone || lead.email) && (
          <div className="space-y-1.5 rounded-lg bg-[var(--surface)] px-3 py-2">
            {lead.phone && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="h-3 w-3 flex-shrink-0 text-[var(--gold)]" />
                <span className="truncate">{lead.phone}</span>
              </div>
            )}
            {lead.email && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3 w-3 flex-shrink-0 text-[var(--gold)]" />
                <span className="truncate">{lead.email}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            <LeadBadges lead={lead} />
          </div>
          {lead.broker && (
            <div className="flex items-center gap-1.5 flex-shrink-0 min-w-0">
              <div
                className="h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white uppercase flex-shrink-0"
                style={{ backgroundColor: lead.broker.color }}
              >
                {lead.broker.full_name.charAt(0)}
              </div>
              <span className="text-xs text-muted-foreground truncate max-w-[80px]">
                {lead.broker.full_name}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export function LeadBadges({ lead }: { lead: Pick<Lead, "status" | "temperatura"> }) {
  return (
    <>
      {lead.status === "won" && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
          Ganho
        </span>
      )}
      {lead.status === "lost" && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
          Perdido
        </span>
      )}
      {lead.temperatura ? (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${temperaturaStyles[lead.temperatura]}`}
        >
          {lead.temperatura}
        </span>
      ) : (
        lead.status === "active" && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--gold)]/15 text-[var(--gold-dark)] border border-[var(--gold)]/30">
            Lead
          </span>
        )
      )}
    </>
  );
}
