import { createBrowserClient } from '@supabase/ssr';

function isSupabaseAuthRequest(input: RequestInfo | URL, supabaseUrl: string) {
  const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;

  try {
    const baseUrl = new URL(supabaseUrl);
    const requestedUrl = new URL(requestUrl, baseUrl);
    const basePath = baseUrl.pathname.replace(/\/+$/, '');

    return requestedUrl.origin === baseUrl.origin
      && requestedUrl.pathname.startsWith(`${basePath}/auth/v1/`);
  } catch {
    return false;
  }
}

function createAuthAwareFetch(supabaseUrl: string): typeof fetch {
  return async (input, init) => {
    try {
      return await globalThis.fetch(input, init);
    } catch (error) {
      if (!(error instanceof TypeError) || !isSupabaseAuthRequest(input, supabaseUrl)) throw error;

      const message = 'Authentication service unavailable';
      return Object.assign(
        new Response(JSON.stringify({ message }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
        { message },
      );
    }
  };
}

// Singleton: multiple createBrowserClient() calls on the same storage key
// trigger Supabase's "Multiple GoTrueClient instances" warning and risk
// desynced sessions. Every browser caller must share this one instance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: ReturnType<typeof createBrowserClient<any>> | undefined;

export function createClient() {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client = createBrowserClient<any>(
      supabaseUrl,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { fetch: createAuthAwareFetch(supabaseUrl) } },
    );
  }
  return client;
}
