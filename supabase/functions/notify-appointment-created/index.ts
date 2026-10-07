import { admin, sendPushToUser } from "../_shared/push.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { appointment_id } = await req.json();
    if (!appointment_id) {
      return new Response(JSON.stringify({ error: "appointment_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = admin();
    const { data: appt, error } = await supabase
      .from("appointments")
      .select("id, owner_id, project_id, reported_at, owner:profiles!appointments_owner_id_fkey(full_name, manager_id), project:projects(name)")
      .eq("id", appointment_id)
      .maybeSingle();

    if (error) throw error;
    if (!appt) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cors });

    const owner: any = appt.owner;
    const project: any = appt.project;
    const managerId = owner?.manager_id;

    if (!managerId) {
      return new Response(JSON.stringify({ ok: true, skipped: "no manager" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Visita vinda do relatório de visitas: já aconteceu, não é um agendamento novo.
    const reported = !!(appt as any).reported_at;
    await sendPushToUser(managerId, {
      title: reported ? "✅ Visita realizada" : "📅 Novo agendamento",
      body: reported
        ? `${owner?.full_name ?? "Corretor"} relatou uma visita ao ${project?.name ?? "imóvel"}`
        : `${owner?.full_name ?? "Corretor"} agendou ${project?.name ?? "imóvel"}`,
      url: reported ? "/relatorio-visitas" : `/appointments?open=${appt.id}`,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[notify-appointment-created]", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
