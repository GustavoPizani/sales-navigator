// Cliente do segundo banco de dados (projeto kvwgtyihxcegylcguncj) para o navegador.
// O login do sistema continua no banco principal, então aqui o acesso é sempre
// anônimo (chave publicável) e depende das políticas de RLS desse banco.
// Para ler/gravar sem depender de RLS, use secondaryAdmin em uma server function.
import { createClient } from '@supabase/supabase-js';

function createSecondaryClient() {
  const SUPABASE_SECONDARY_URL =
    import.meta.env.VITE_SUPABASE_SECONDARY_URL ||
    process.env.VITE_SUPABASE_SECONDARY_URL ||
    process.env.SUPABASE_SECONDARY_URL;
  const SUPABASE_SECONDARY_PUBLISHABLE_KEY =
    import.meta.env.VITE_SUPABASE_SECONDARY_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_SECONDARY_PUBLISHABLE_KEY ||
    process.env.SUPABASE_SECONDARY_PUBLISHABLE_KEY;

  if (!SUPABASE_SECONDARY_URL || !SUPABASE_SECONDARY_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_SECONDARY_URL ? ['SUPABASE_SECONDARY_URL'] : []),
      ...(!SUPABASE_SECONDARY_PUBLISHABLE_KEY ? ['SUPABASE_SECONDARY_PUBLISHABLE_KEY'] : []),
    ];
    throw new Error(`Missing Supabase environment variable(s): ${missing.join(', ')}`);
  }

  return createClient(SUPABASE_SECONDARY_URL, SUPABASE_SECONDARY_PUBLISHABLE_KEY, {
    // sem sessão própria, para não mexer na sessão do banco principal no localStorage
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let _secondary: ReturnType<typeof createSecondaryClient> | undefined;

// Import like: import { supabaseSecondary } from "@/integrations/supabase/secondary";
export const supabaseSecondary = new Proxy({} as ReturnType<typeof createSecondaryClient>, {
  get(_, prop, receiver) {
    if (!_secondary) _secondary = createSecondaryClient();
    return Reflect.get(_secondary, prop, receiver);
  },
});
