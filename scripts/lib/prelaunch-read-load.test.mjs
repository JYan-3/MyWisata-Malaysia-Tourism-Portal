import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { origin, runStage, validateBody } from './prelaunch-read-load.mjs';

const healthy = () => new Response(JSON.stringify({ status: 'ok', checks: { database: 'ok' } }),
  { headers: { 'content-type': 'application/json' } });

test('validates content instead of accepting an error/login/fallback page with status 200', () => {
  validateBody('health', 'application/json', JSON.stringify({ status: 'ok', checks: { database: 'ok' } }));
  assert.throws(() => validateBody('health', 'text/html', '<html>login</html>'));
  assert.throws(() => validateBody('health', 'application/json', '{"status":"unavailable"}'));
  assert.throws(() => validateBody('campaigns', 'application/json', '{"data":null,"error":{}}'));
  assert.throws(() => validateBody('search', 'application/json', '{}'));
  assert.throws(() => validateBody('explore', 'text/html', '<html>Explore Malaysia "dataUnavailable":true</html>'));
  assert.throws(() => validateBody('explore', 'text/html', '<html>Explore Malaysia \\"dataUnavailable\\":true</html>'));
});

test('requests are fixed-origin GETs without credentials or redirect following', async () => {
  const stage = await runStage({ name: 'test', rps: 4, durationMs: 50 }, { fetcher: async (url, options) => {
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, '/api/health');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.headers.authorization, undefined);
    return healthy();
  } });
  assert.equal(stage.started, 1);
  assert.equal(stage.byRoute.health.ok, 1);
});

test('first 429 stops scheduling rather than retrying or escalating', async () => {
  let calls = 0;
  const stage = await runStage({ name: 'test', rps: 4, durationMs: 1000 }, { fetcher: async () => {
    calls += 1;
    return new Response('limited', { status: 429 });
  } });
  assert.equal(calls, 1);
  assert.equal(stage.stopReason, 'health:http_429');
  assert.equal(stage.notIssuedAfterStop, 3);
});

test('arrival clock counts skipped requests and never creates an unbounded queue', async () => {
  let active = 0;
  let peak = 0;
  const stage = await runStage({ name: 'test', rps: 4, durationMs: 1000 }, {
    maxConcurrent: 1,
    fetcher: async (url) => {
      peak = Math.max(peak, ++active);
      await sleep(600);
      active -= 1;
      return url.pathname === '/customer/explore'
        ? new Response('<html>Explore Malaysia</html>', { headers: { 'content-type': 'text/html' } })
        : healthy();
    },
  });
  assert.equal(peak, 1);
  assert.equal(stage.peakInFlight, 1);
  assert.equal(stage.stopReason, null);
  assert.ok(stage.skippedAtClientCap > 0);
  assert.equal(stage.started + stage.skippedAtClientCap + stage.notIssuedAfterStop, stage.planned);
});

test('exhausted global request budget issues no request', async () => {
  const stage = await runStage({ name: 'test', rps: 1, durationMs: 50 }, {
    budget: { issued: 180 }, fetcher: () => assert.fail('must not send a request'),
  });
  assert.equal(stage.started, 0);
  assert.equal(stage.stopReason, 'global_budget');
});
