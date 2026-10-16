import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261015164821_public_content_translation_queue.sql'),
  'utf8',
);

describe('public content translation queue migration', () => {
  it('keeps public machine translations separate from admin-reviewed recommendation drafts', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.public_content_translations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.content_translation_jobs');
    expect(migration).not.toMatch(/ALTER TABLE public\.content_translations/i);
    expect(migration).not.toMatch(/INSERT INTO public\.content_translations/i);
  });

  it('stores only hashes and translated text, never a duplicate source body in jobs/cache', () => {
    expect(migration).toMatch(/source_hash[^,\n]*text/i);
    expect(migration).toMatch(/translated_text/i);
    const jobTable = migration.match(/CREATE TABLE IF NOT EXISTS public\.content_translation_jobs \(([\s\S]*?)\);/i)?.[1] ?? '';
    const cacheTable = migration.match(/CREATE TABLE IF NOT EXISTS public\.public_content_translations \(([\s\S]*?)\);/i)?.[1] ?? '';
    expect(jobTable).not.toMatch(/source_text|translated_text/i);
    expect(cacheTable).not.toMatch(/source_text/i);
  });

  it('keeps cache and queue private and limits RPC access to service_role', () => {
    expect(migration).toMatch(/ALTER TABLE public\.public_content_translations ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.content_translation_jobs ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.public_content_translations[^;]*FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.content_translation_jobs[^;]*FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT ALL ON TABLE public\.public_content_translations[^;]*TO service_role/i);
  });

  it('deduplicates jobs and claims with an atomic service-only lease', () => {
    expect(migration).toMatch(/UNIQUE\s*\(entity_type, entity_key, field, locale, source_hash\)/i);
    expect(migration).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(migration).toMatch(/lease_token/i);
    expect(migration).toMatch(/service_role_required/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.enqueue_content_translation_jobs[\s\S]*?public\.claim_content_translation_jobs[^;]*TO service_role/i);
  });

  it('uses the installed pgcrypto schema and can requeue a completed job after cache invalidation', () => {
    expect(migration).toMatch(/extensions\.digest\(v_source, 'sha256'\)/i);
    expect(migration).not.toMatch(/(?<![.\w])digest\(v_source, 'sha256'\)/i);
    expect(migration).toMatch(/status IN \('failed', 'superseded', 'completed'\)[\s\S]*?NOT EXISTS\s*\([\s\S]*?FROM public\.public_content_translations AS cached[\s\S]*?cached\.source_hash = EXCLUDED\.source_hash/i);
  });

  it('backfills active public content in bounded keyset batches through the campaign projection', () => {
    expect(migration).toMatch(/backfill_public_content_translation_jobs\(p_limit INTEGER DEFAULT 50\)/i);
    expect(migration).toMatch(/least\(coalesce\(p_limit, 50\), 100\)/i);
    expect(migration).toMatch(/cursor_entity_type[\s\S]*?cursor_entity_key/i);
    expect(migration).toMatch(/get_public_promotion_campaigns\(NULL\)/i);
    expect(migration).toMatch(/completed BOOLEAN NOT NULL DEFAULT FALSE/i);
    expect(migration).toMatch(/set_public_content_translation_backfill_paused\(p_paused BOOLEAN\)/i);
    expect(migration).toMatch(/paused BOOLEAN NOT NULL DEFAULT FALSE/i);
  });

  it('invalidates queued work and cached copy when canonical content changes', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION app_private\.invalidate_public_content_translations/i);
    expect(migration).toMatch(/status = 'superseded'/i);
    expect(migration).toMatch(/TRIGGER/i);
  });
});
