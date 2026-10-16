#!/usr/bin/env node
/** Hostinger Node.js Cron entry point. Secret stays in its existing server env. */
const routes = {
  expire: '/api/cron/expire-checkout-sessions',
  refunds: '/api/cron/process-event-refunds',
  'guest-rate-limits': '/api/cron/purge-guest-rate-limits',
};
try {
  const route = routes[process.argv[2]];
  if (!route || process.argv.length !== 3) throw new Error('cron_task_invalid');
  const origin = new URL(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('cron_origin_invalid');
  if (!process.env.CRON_SECRET) throw new Error('cron_secret_missing');
  const response = await fetch(new URL(route, origin), { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!response.ok) throw new Error('cron_execution_failed');
  const result = await response.json();
  const counts = Object.fromEntries(Object.entries(result).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
  console.log(JSON.stringify({ task: process.argv[2], ok: true, ...counts }));
} catch {
  console.error('event_cron_execution_unavailable');
  process.exitCode = 1;
}
