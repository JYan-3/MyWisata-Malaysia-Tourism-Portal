import { expect, it, vi } from 'vitest';
import { executeCron } from '../run-event-cron.mjs';
it('uses POST for KYC and rejects disabled or uncertain results', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ enabled: true, stopReason: 'single_batch', claimed: 1, acknowledged: 1, unavailable: 0, notAcknowledged: 0, writeErrors: 0 }));
  await executeCron('kyc-prescreening', { APP_URL: 'https://mylawatan.my', CRON_SECRET: 'private-token' }, fetch);
  expect(fetch.mock.calls[0][1].method).toBe('POST');
  expect(fetch.mock.calls[0][0].href).not.toContain('private-token');
  fetch.mockResolvedValue(Response.json({ enabled: false, stopReason: 'disabled', writeErrors: 0 }));
  await expect(executeCron('kyc-prescreening', { APP_URL: 'https://mylawatan.my', CRON_SECRET: 'secret' }, fetch)).rejects.toThrow('cron_execution_failed');
});
it('keeps existing tasks GET and rejects missing credentials before HTTP', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ processed: 1 }));
  await executeCron('expire', { APP_URL: 'https://mylawatan.my', CRON_SECRET: 'secret' }, fetch);
  expect(fetch.mock.calls[0][1].method).toBe('GET');
  fetch.mockClear();
  await expect(executeCron('expire', { APP_URL: 'https://mylawatan.my' }, fetch)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it('does not send the cron credential to a mistakenly configured foreign origin', async () => {
  const fetch = vi.fn();
  await expect(executeCron('kyc-prescreening', { APP_URL: 'https://foreign.example', CRON_SECRET: 'secret' }, fetch)).rejects.toThrow('cron_origin_invalid');
  expect(fetch).not.toHaveBeenCalled();
});
