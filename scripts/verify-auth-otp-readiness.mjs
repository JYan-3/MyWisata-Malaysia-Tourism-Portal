#!/usr/bin/env node
/** Read-only deployment checks. Never sends a code or invokes a reservation RPC. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const reservationReadinessSql = [
  "SELECT p.oid IS NOT NULL AS present, COALESCE(p.prosecdef,false) AS security_definer,",
  "COALESCE(has_function_privilege('service_role',p.oid,'EXECUTE'),false) AS service_execute,",
  "COALESCE(has_function_privilege('authenticated',p.oid,'EXECUTE'),true) AS authenticated_execute,",
  "COALESCE(has_function_privilege('anon',p.oid,'EXECUTE'),true) AS anon_execute,",
  "COALESCE(pg_get_functiondef(p.oid) LIKE '%otp_reservation_service_only%',false) AS role_guard,",
  "COALESCE(pg_get_functiondef(p.oid) LIKE '%pg_advisory_xact_lock%',false) AS atomic_quota",
  "FROM (SELECT to_regprocedure('public.reserve_phone_otp_send(uuid,text)') AS oid) r",
  "LEFT JOIN pg_proc p ON p.oid=r.oid",
].join('\n');

/** @param {{projectRef?: string, managementToken?: string, siteKey?: string, secretKey?: string, siteUrl?: string, allowedHostnames?: string, query?: (sql: string) => Promise<Array<Record<string, boolean>>>, fetcher?: typeof fetch}} options */
export async function inspectAuthOtpReadiness({
  projectRef, managementToken, siteKey, secretKey, siteUrl, allowedHostnames, query, fetcher = fetch,
}) {
  /** @type {Record<string, boolean | null>} */
  const checks = {
    siteKeyPresent: Boolean(siteKey) && !/^[123]x0+/.test(siteKey),
    secretKeyPresent: Boolean(secretKey) && !/^[123]x0+/.test(secretKey),
    challengeHostnamesPresent: false,
    reservationReady: null,
    nativeCaptchaEnabled: null,
    nativeProviderMatches: null,
    nativeSecretMatches: null,
    passwordPolicyMatches: null,
    emailOtpMatches: null,
    nativeRateLimitsPresent: null,
  };
  try {
    const hosts = allowedHostnames?.split(',').map((host) => host.trim()).filter(Boolean);
    checks.challengeHostnamesPresent = hosts?.length ? hosts.every((host) => /^[a-z0-9.-]+$/i.test(host)) : Boolean(new URL(siteUrl ?? '').hostname);
  } catch { /* Hostname configuration is required by the custom SMS validator. */ }
  const validRef = /^[a-z0-9]{20}$/.test(projectRef ?? '');
  const management = async (suffix, options) => {
    const response = await fetcher('https://api.supabase.com/v1/projects/' + projectRef + suffix, {
      ...options,
      headers: { Authorization: 'Bearer ' + managementToken, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (!response.ok) throw new Error('readiness_check_unavailable');
    return response.json();
  };
  try {
    const rows = query ? await query(reservationReadinessSql)
      : managementToken && validRef ? await management('/database/query', { method: 'POST', body: JSON.stringify({ query: reservationReadinessSql }) })
        : null;
    if (rows) {
      const row = rows[0];
      checks.reservationReady = Boolean(row?.present && row.security_definer && row.service_execute
        && !row.authenticated_execute && !row.anon_execute && row.role_guard && row.atomic_quota);
    }
  } catch { /* Unchecked is not ready. Never output raw database/provider errors. */ }
  if (managementToken && validRef) {
    try {
      const config = await management('/config/auth', { method: 'GET' });
      checks.nativeCaptchaEnabled = config.security_captcha_enabled === true;
      checks.nativeProviderMatches = config.security_captcha_provider === 'turnstile';
      checks.nativeSecretMatches = typeof config.security_captcha_secret === 'string' && !/^\*+$/.test(config.security_captcha_secret)
        ? Boolean(secretKey) && config.security_captcha_secret === secretKey : null;
      const required = String(config.password_required_characters ?? '').split(':');
      checks.passwordPolicyMatches = config.password_min_length >= 10
        && ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789'].every((set) => required.includes(set));
      checks.nativeRateLimitsPresent = config.rate_limit_email_sent > 0 && config.rate_limit_verify > 0 && config.smtp_max_frequency > 0;
      checks.emailOtpMatches = config.mailer_otp_length === 6 && config.mailer_otp_exp > 0 && config.mailer_otp_exp <= 600;
    } catch { /* Configuration remains explicitly unverified. */ }
  }
  return { ready: Object.values(checks).every((value) => value === true), checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of ['.env', '.env.local']) if (existsSync(file)) process.loadEnvFile(file);
  const env = process.env;
  let projectRef = env.SUPABASE_PROJECT_REF;
  if (!projectRef && env.NEXT_PUBLIC_SUPABASE_URL) projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const result = await inspectAuthOtpReadiness({
    projectRef, managementToken: env.SUPABASE_ACCESS_TOKEN,
    siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, secretKey: env.TURNSTILE_SECRET_KEY,
    siteUrl: env.NEXT_PUBLIC_SITE_URL, allowedHostnames: env.TURNSTILE_ALLOWED_HOSTNAMES,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
}
