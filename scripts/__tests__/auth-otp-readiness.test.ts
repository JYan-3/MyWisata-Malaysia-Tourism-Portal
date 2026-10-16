import { describe, expect, it, vi } from 'vitest';
import { inspectAuthOtpReadiness, reservationReadinessSql } from '../verify-auth-otp-readiness.mjs';

describe('read-only Auth deployment preflight', () => {
  it('does not turn missing management access into a passing result', async () => {
    const result = await inspectAuthOtpReadiness({});
    expect(result.ready).toBe(false);
    expect(result.checks.reservationReady).toBeNull();
    expect(result.checks.nativeCaptchaEnabled).toBeNull();
  });
  it('detects a missing reservation without invoking it or leaking configuration', async () => {
    const query = vi.fn().mockResolvedValue([{ present: false }]);
    const result = await inspectAuthOtpReadiness({ query, siteKey: 'public-key', secretKey: 'private-secret' });
    expect(result.checks.reservationReady).toBe(false);
    expect(query).toHaveBeenCalledWith(reservationReadinessSql);
    expect(reservationReadinessSql).not.toMatch(/INSERT|UPDATE|DELETE|SELECT public\.reserve/i);
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it('requires native enforcement and safe privileges even when code configuration exists', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      security_captcha_enabled: false, security_captcha_provider: 'turnstile',
      security_captcha_secret: 'private-secret', smtp_pass: 'never-output',
    })));
    const result = await inspectAuthOtpReadiness({
      projectRef: 'ncdlaehknicabzjqskvk', managementToken: 'private-token',
      siteKey: 'public-key', secretKey: 'private-secret', siteUrl: 'https://mywisata.test', fetcher,
      query: async () => [{ present: true, security_definer: true, service_execute: true, authenticated_execute: true, anon_execute: false, role_guard: true, atomic_quota: true }],
    });
    expect(result.ready).toBe(false);
    expect(result.checks.nativeCaptchaEnabled).toBe(false);
    expect(result.checks.reservationReady).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/private-token|private-secret|never-output/);
    expect(fetcher.mock.calls[0][1].method).toBe('GET');
  });
  it('accepts the actual Management API character-set format only with all checks satisfied', async () => {
    const result = await inspectAuthOtpReadiness({
      projectRef: 'ncdlaehknicabzjqskvk', managementToken: 'management-token',
      siteKey: 'public-key', secretKey: 'private-secret', siteUrl: 'https://mywisata.test',
      query: async () => [{ present: true, security_definer: true, service_execute: true, authenticated_execute: false, anon_execute: false, role_guard: true, atomic_quota: true }],
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        security_captcha_enabled: true, security_captcha_provider: 'turnstile', security_captcha_secret: 'private-secret',
        password_min_length: 10, password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
        mailer_otp_length: 6, mailer_otp_exp: 600, rate_limit_email_sent: 50, rate_limit_verify: 30, smtp_max_frequency: 60,
      }))),
    });
    expect(result.ready).toBe(true);
  });
});
