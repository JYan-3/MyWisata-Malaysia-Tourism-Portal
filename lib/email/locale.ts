import type { SupabaseClient } from '@supabase/supabase-js';
import { isAppLocale, LOCALE_COOKIE, type AppLocale } from '@/lib/i18n/locale';

/** A Guest's explicit choice must be captured before an asynchronous callback. */
export function checkoutEmailLocale(request: Request): AppLocale {
  const raw = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${LOCALE_COOKIE}=`))?.slice(LOCALE_COOKIE.length + 1);
  try { const value = decodeURIComponent(raw ?? ''); return isAppLocale(value) ? value : 'en'; }
  catch { return 'en'; }
}

/** Server-only callers must perform their existing authorization before this lookup. */
export async function recipientEmailLocale(db: SupabaseClient, email: string): Promise<AppLocale> {
  const { data, error } = await db.from('users').select('preferred_locale').eq('email', email.trim().toLowerCase()).maybeSingle();
  if (error) throw new Error('email_recipient_locale_unavailable');
  return isAppLocale(data?.preferred_locale) ? data.preferred_locale : 'en';
}
