import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, resolveAppLocale } from '@/lib/i18n/locale';
import { staffAssurance } from '@/lib/auth/staff-assurance';
import { staffPasskeyEnforcementEnabled } from '@/lib/auth/staff-passkey-config';
import { isStaffProtectedPath, staffVerificationDestination } from '@/lib/auth/staff-route-boundaries';

const localeCookieOptions = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};

/**
 * Keep the Supabase session cookie fresh before Next renders a page or calls a
 * protected route. Server Components cannot reliably write refreshed cookies,
 * so this must run in the request Proxy.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const forwardedHeaders = new Headers(request.headers);
  const pendingCookies: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
  const responseHeaders = new Headers();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            pendingCookies.push({ name, value, options: options as Record<string, unknown> });
          });

          const requestCookieHeader = request.headers.get('cookie');
          if (requestCookieHeader === null) forwardedHeaders.delete('cookie');
          else forwardedHeaders.set('cookie', requestCookieHeader);

          Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
        },
      },
    },
  );

  // getClaims validates the access token and refreshes it when necessary.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  let accountLocale: string | null = null;

  if (typeof claims?.sub === 'string' && claims.sub) {
    try {
      const { data: account } = await supabase
        .from('users')
        .select('preferred_locale')
        .eq('id', claims.sub)
        .maybeSingle();
      accountLocale = account?.preferred_locale ?? null;
    } catch {
      // A missing account preference should not block auth refresh or rendering.
    }
  }

  const locale = resolveAppLocale({
    accountLocale,
    cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get('accept-language'),
  });

  forwardedHeaders.set('x-app-locale', locale);
  let supabaseResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
  if (isStaffProtectedPath(request.nextUrl.pathname) && staffPasskeyEnforcementEnabled()) {
    try {
      const status = claims?.sub ? await staffAssurance(supabase) : null;
      if (!status?.required || !status.verified) {
        supabaseResponse = request.nextUrl.pathname.startsWith('/api/')
          ? NextResponse.json({ data: null, error: { code: 'STAFF_PASSKEY_REQUIRED', message: 'Password and Passkey verification required' } }, { status: claims?.sub ? 403 : 401 })
          : NextResponse.redirect(new URL(claims?.sub ? staffVerificationDestination(request.nextUrl.pathname + request.nextUrl.search) : '/login', request.url));
      }
    } catch {
      supabaseResponse = request.nextUrl.pathname.startsWith('/api/')
        ? NextResponse.json({ data: null, error: { code: 'AUTHORIZATION_UNAVAILABLE', message: 'Staff verification unavailable' } }, { status: 503 })
        : NextResponse.redirect(new URL(staffVerificationDestination(request.nextUrl.pathname + request.nextUrl.search), request.url));
    }
    supabaseResponse.headers.set('Cache-Control', 'private, no-store');
  }

  responseHeaders.forEach((value, key) => supabaseResponse.headers.set(key, value));
  pendingCookies.forEach(({ name, value, options }) =>
    supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2]),
  );
  supabaseResponse.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions);

  return supabaseResponse;
}
