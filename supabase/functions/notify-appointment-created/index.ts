import { sendPushToUser, supabaseAdmin } from "../_shared/push.ts";

// Triggered by a Postgres trigger (see migration) right after an appointment
// is inserted. Notifies the broker's manager with which broker and which
// imóvel now has an agendamento.
Deno.serve(async (req) => {
  try {
    const { appointment_id } = await req.json();
    if (!appointment_id) {
      return new Response(JSON.stringify({ error: "Missing appointment_id" }), { status: 400 });
    }

    const { data: appt, error } = await supabaseAdmin
      .from("appointments")
      .select(
        "id, date, start_time, owner:owner_id(full_name, manager_id), project:project_id(name)"
      )
      .eq("id", appointment_id)
      .maybeSingle();

    if (error || !appt) {
      return new Response(JSON.stringify({ error: error?.message ?? "Appointment not found" }), {
        status: 404,
      });
    }

    const owner = (appt as any).owner;
    const project = (appt as any).project;
    const managerId = owner?.manager_id as string | null;

    if (managerId) {
      const brokerName = owner?.full_name ?? "Um corretor";
      const productName = project?.name ?? "um imóvel";
      await sendPushToUser(
        managerId,
        "📅 Novo agendamento",
        `${brokerName} agendou ${productName}`,
        "/agendamentos"
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
