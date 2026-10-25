import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entrypoint = path.join(repoRoot, 'scripts/apply-migrations.mjs');

test('legacy migration reset fails closed before connecting or exposing database configuration', () => {
  const result = spawnSync(process.execPath, [entrypoint], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      SUPABASE_DB_URL: 'postgres://sentinel-user:sentinel-password@example.invalid/never-connect',
      DATABASE_URL: 'postgres://sentinel-user:sentinel-password@example.invalid/never-connect',
    },
    encoding: 'utf8',
    timeout: 5_000,
  });

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Legacy destructive migration reset is disabled/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /sentinel-(?:user|password)|example\.invalid/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Connected to Postgres|Dropping existing public schema|Applying \d/);
});
