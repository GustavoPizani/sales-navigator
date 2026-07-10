import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const shortenSchema = z.object({
  url: z.string().url(),
});

export const shortenUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => shortenSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(data.url)}`);
      const text = (await res.text()).trim();
      if (!res.ok || !text.startsWith("http")) throw new Error("Falha ao encurtar link");
      return { shortUrl: text };
    } catch {
      // Se o encurtador falhar, segue com o link original — não deve travar o fluxo.
      return { shortUrl: data.url };
    }
  });
