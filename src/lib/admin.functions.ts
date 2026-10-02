import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TEMP_PASSWORD = "Acesso@2025";

const createBrokerSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).max(120),
  phone: z.string().max(30).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const createBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createBrokerSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: caller } = await context.supabase
      .from("profiles").select("role").eq("id", context.userId).single();
    if (!caller || (caller.role !== "admin" && caller.role !== "master")) throw new Error("Forbidden");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !created.user) throw new Error(error?.message || "Failed to create user");

    const { error: pErr } = await supabaseAdmin.from("profiles").update({
      full_name: data.full_name,
      phone: data.phone ?? null,
      color: data.color,
      role: "broker",
      is_active: true,
      manager_id: context.userId,
    }).eq("id", created.user.id);
    if (pErr) throw new Error(pErr.message);

    return { id: created.user.id };
  });

const deleteUserSchema = z.object({
  id: z.string().uuid(),
});

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: caller } = await context.supabase
      .from("profiles").select("role").eq("id", context.userId).single();
    if (!caller || (caller.role !== "admin" && caller.role !== "master" && caller.role !== "director")) {
      throw new Error("Forbidden");
    }
    // Não apaga a conta de login (auth.users) — isso exige a service role key,
    // que não está disponível no ambiente. Em vez disso, desativa o perfil:
    // o corretor some das listas de time (profiles_team_view exige is_active)
    // e perde acesso, sem precisar de privilégios de admin do Supabase Auth.
    const { error } = await context.supabase
      .from("profiles")
      .update({ is_active: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const updateBrokerSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().min(1).max(120).optional(),
  phone: z.string().max(30).nullable().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  is_active: z.boolean().optional(),
});

export const updateBroker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateBrokerSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: caller } = await context.supabase
      .from("profiles").select("role").eq("id", context.userId).single();
    if (!caller || (caller.role !== "admin" && caller.role !== "master")) throw new Error("Forbidden");
    const { id, ...patch } = data;
    // Usa a service role (ignora RLS): o gerente só altera corretores da própria equipe.
    if (caller.role === "master") {
      const { data: target } = await supabaseAdmin.from("profiles").select("manager_id").eq("id", id).single();
      if (!target || target.manager_id !== context.userId) throw new Error("Forbidden");
    }
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
