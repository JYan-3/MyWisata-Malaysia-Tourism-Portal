import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cleanUserContent } from "@/lib/moderation/clean";
import { classifyTicket } from "@/lib/chatbot/classify";
import { apiFail, apiOk, parseBody } from "@/lib/validation/schemas";
import { z } from "zod";

const appealSchema = z.object({
  body: z.string().trim().min(10, "Appeal must be at least 10 characters").max(2000),
}).strict();

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail("UNAUTHORIZED", "Sign in required", 401);

  const parsed = await parseBody(request, appealSchema, { maxBytes: 16_384 });
  if (!parsed.ok) return parsed.response;
  // Appeals can contain identity/bank information. Keep the entire free-text
  // path local; pattern redaction alone cannot make arbitrary text public.
  let body: string;
  try { body = (await cleanUserContent(parsed.data.body, createServiceClient())).display; }
  catch { return apiFail("CONTENT_PROCESSING_UNAVAILABLE", "Unable to prepare your appeal; please try again", 503); }
  const category = classifyTicket(`Account suspension appeal ${body}`);
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: user.id,
      session_id: null,
      subject: "Account suspension appeal",
      body,
      category,
      classification_method: "keyword",
      status: "open",
    })
    .select("id")
    .single();

  if (error) return apiFail("DB_ERROR", error.message, 500);
  return apiOk({ id: data.id, category }, { status: 201 });
}
