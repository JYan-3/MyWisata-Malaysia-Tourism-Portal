import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isSameOriginMutation, readGuestJson, guestPrivateResponse } from '@/lib/checkout/guest-session';
import { reserveAiQuota } from '@/lib/rate-limit/ai';
import { apiFail } from '@/lib/validation/schemas';
import { isPublicTranslationField, isSupportedTranslationLocale, PUBLIC_TRANSLATION_FIELDS, type PublicTranslationRequestItem } from '@/lib/content-translations/contract';
import { resolvePublicContentTranslations } from '@/lib/content-translations/server';

const entityTypes = Object.keys(PUBLIC_TRANSLATION_FIELDS) as [keyof typeof PUBLIC_TRANSLATION_FIELDS, ...(keyof typeof PUBLIC_TRANSLATION_FIELDS)[]];
const requestSchema = z.object({
  locale: z.string().refine(isSupportedTranslationLocale),
  items: z.array(z.object({
    entityType: z.enum(entityTypes),
    entityId: z.string().uuid(),
    fields: z.array(z.string().min(1).max(40)).min(1).max(3),
  }).strict()).min(1).max(40),
}).strict().superRefine((body, context) => {
  let fieldCount = 0;
  const seen = new Set<string>();
  body.items.forEach((item, itemIndex) => {
    item.fields.forEach((field, fieldIndex) => {
      fieldCount += 1;
      if (!isPublicTranslationField(item.entityType, field)) {
        context.addIssue({ code: 'custom', path: ['items', itemIndex, 'fields', fieldIndex], message: 'Unsupported translation field' });
      }
      const key = `${item.entityType}:${item.entityId}:${field}`;
      if (seen.has(key)) context.addIssue({ code: 'custom', path: ['items', itemIndex], message: 'Duplicate translation field' });
      seen.add(key);
    });
  });
  if (fieldCount > 80) context.addIssue({ code: 'custom', path: ['items'], message: 'Too many translation fields' });
});

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiFail('FORBIDDEN', 'Use the customer website', 403);
  const parsed = requestSchema.safeParse(await readGuestJson(request));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'Choose valid public content', 422);

  try {
    const { data: { user } } = await (await createClient()).auth.getUser();
    const { locale, items } = parsed.data;
    const translations = await resolvePublicContentTranslations(
      createServiceClient(),
      locale,
      items as PublicTranslationRequestItem[],
      () => reserveAiQuota(request, 'content-translation-enqueue', user?.id ?? null, 20),
    );
    return guestPrivateResponse({ translations });
  } catch {
    return apiFail('CONTENT_TRANSLATION_UNAVAILABLE', 'Translations are temporarily unavailable', 503);
  }
}
