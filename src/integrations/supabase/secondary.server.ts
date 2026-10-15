// Cliente de servidor do segundo banco de dados (projeto kvwgtyihxcegylcguncj).
// Usa a chave secreta e ignora o RLS: só pode ser importado em server functions
// e server routes, nunca em código que vai para o navegador.
import { createClient } from '@supabase/supabase-js';

function createSecondaryAdminClient() {
  const SUPABASE_SECONDARY_URL = process.env.SUPABASE_SECONDARY_URL;
  const SUPABASE_SECONDARY_SECRET_KEY = process.env.SUPABASE_SECONDARY_SECRET_KEY;

  if (!SUPABASE_SECONDARY_URL || !SUPABASE_SECONDARY_SECRET_KEY) {
    const missing = [
      ...(!SUPABASE_SECONDARY_URL ? ['SUPABASE_SECONDARY_URL'] : []),
      ...(!SUPABASE_SECONDARY_SECRET_KEY ? ['SUPABASE_SECONDARY_SECRET_KEY'] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(', ')}.`;
    console.error(`[Supabase secondary] ${message}`);
    throw new Error(message);
  }

  return createClient(SUPABASE_SECONDARY_URL, SUPABASE_SECONDARY_SECRET_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _secondaryAdmin: ReturnType<typeof createSecondaryAdminClient> | undefined;

// Import like: import { secondaryAdmin } from "@/integrations/supabase/secondary.server";
export const secondaryAdmin = new Proxy({} as ReturnType<typeof createSecondaryAdminClient>, {
  get(_, prop, receiver) {
    if (!_secondaryAdmin) _secondaryAdmin = createSecondaryAdminClient();
    return Reflect.get(_secondaryAdmin, prop, receiver);
  },
});
