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
    // Delete from auth.users — cascades to profiles via FK or trigger
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
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
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
