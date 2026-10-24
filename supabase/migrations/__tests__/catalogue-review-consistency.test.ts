import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261023141512_approver_state_consistency.sql'), 'utf8');

describe('catalogue review transaction boundary', () => {
  it('locks and version-checks every supported review entity before committing history and audit', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.review_catalogue_item/i);
    expect(migration).toMatch(/FOR UPDATE/i);
    expect(migration).toMatch(/\(v_before->>'updated_at'\)::timestamptz IS DISTINCT FROM p_expected_updated_at/i);
    expect(migration).toMatch(/INSERT INTO public\.content_reviews/i);
    expect(migration).toMatch(/INSERT INTO public\.audit_logs/i);
    expect(migration).toMatch(/has_staff_permission\(v_actor_id, 'admin\.catalogue\.review'\)/i);
  });

  it('paginates the combined catalogue queue in the database with exact total counts', () => {
    expect(migration).toMatch(/FUNCTION public\.list_catalogue_review_queue\s*\(\s*p_page integer,\s*p_page_size integer,\s*p_entity_type text\s*\)/i);
    expect(migration).toMatch(/ORDER BY created_at DESC, id DESC, entity_type ASC\s+OFFSET/i);
    expect(migration).toMatch(/LIMIT p_page_size/i);
    expect(migration).toMatch(/'total'/i);
    expect(migration).toMatch(/'counts'/i);
  });

  it('restricts the security-definer review RPC to authenticated staff', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.review_catalogue_item\(text, uuid, timestamptz, text, text\) FROM PUBLIC, anon/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.review_catalogue_item\(text, uuid, timestamptz, text, text\) TO authenticated/i);
    expect(migration).toMatch(/v_actor_id uuid := auth\.uid\(\)/i);
  });
});
