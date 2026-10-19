import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteDemoSeedBlockReason } from './demo-seed-guard.mjs';

test('requires both explicit seed opt-in and an explicit staging environment', () => {
  assert.match(remoteDemoSeedBlockReason({}), /REMOTE_DEMO_SEED=1/);
  assert.match(remoteDemoSeedBlockReason({ REMOTE_DEMO_SEED: '1' }), /MYLAWATAN_ENV=staging/);
  assert.equal(remoteDemoSeedBlockReason({ REMOTE_DEMO_SEED: '1', MYLAWATAN_ENV: 'staging', NODE_ENV: 'test' }), null);
});

test('never permits remote demo seeding in production', () => {
  assert.match(remoteDemoSeedBlockReason({ REMOTE_DEMO_SEED: '1', MYLAWATAN_ENV: 'staging', VERCEL_ENV: 'production' }), /production/);
  assert.match(remoteDemoSeedBlockReason({ REMOTE_DEMO_SEED: '1', MYLAWATAN_ENV: 'staging', NODE_ENV: 'production' }), /production/);
  assert.match(remoteDemoSeedBlockReason({ REMOTE_DEMO_SEED: '1', MYWISATA_ENV: 'production' }), /production/);
});

test('accepts the previous staging variable during the rename transition', () => {
  assert.equal(remoteDemoSeedBlockReason({ REMOTE_DEMO_SEED: '1', MYWISATA_ENV: 'staging', NODE_ENV: 'test' }), null);
});

test('gives the renamed environment variable precedence over the legacy value', () => {
  assert.match(remoteDemoSeedBlockReason({
      REMOTE_DEMO_SEED: '1',
      MYLAWATAN_ENV: 'production',
      MYWISATA_ENV: 'staging',
      NODE_ENV: 'test',
  }), /production/);
});
