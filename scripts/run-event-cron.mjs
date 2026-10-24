#!/usr/bin/env node
/** Hostinger Node.js Cron entry point. Secret stays in its existing server env. */
import { pathToFileURL } from 'node:url';
const routes = {
  expire: { path: '/api/cron/expire-checkout-sessions', method: 'GET' },
  refunds: { path: '/api/cron/process-event-refunds', method: 'GET' },
  'guest-rate-limits': { path: '/api/cron/purge-guest-rate-limits', method: 'GET' },
  'kyc-prescreening': { path: '/api/cron/process-kyc-prescreening', method: 'POST' },
  'queue-health': { path: '/api/cron/process-kyc-prescreening', method: 'GET' },
  'email-outbox': { path: '/api/cron/process-email-outbox', method: 'GET' },
  'recommendation-images': { path: '/api/cron/purge-recommendation-images', method: 'GET' },
};
/** @param {string} task @param {{APP_URL?: string, NEXT_PUBLIC_APP_URL?: string, CRON_SECRET?: string}} env */
export async function executeCron(task, env = process.env, request = fetch) {
  const route = Object.hasOwn(routes, task) ? routes[task] : null;
  if (!route) throw new Error('cron_task_invalid');
  const origin = new URL(env.APP_URL || env.NEXT_PUBLIC_APP_URL || '');
  if (origin.origin !== 'https://mylawatan.my' || origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('cron_origin_invalid');
  if (!env.CRON_SECRET) throw new Error('cron_secret_missing');
  const response = await request(new URL(route.path, origin), { method: route.method, headers: { authorization: `Bearer ${env.CRON_SECRET}` }, signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error('cron_execution_failed');
  const result = await response.json();
  if (task === 'kyc-prescreening' && (!result?.enabled || !['empty', 'single_batch'].includes(result.stopReason) || result.writeErrors !== 0 || result.notAcknowledged !== 0 || result.unavailable !== 0)) throw new Error('cron_execution_failed');
  const counts = Object.fromEntries(Object.entries(result).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
  return { task, ok: true, ...counts };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('cron_task_invalid');
    console.log(JSON.stringify(await executeCron(process.argv[2])));
  } catch { console.error('event_cron_execution_unavailable'); process.exitCode = 1; }
}
