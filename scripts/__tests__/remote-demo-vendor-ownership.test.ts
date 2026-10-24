import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { vendorOwnerIdForSlug } from '../lib/vendor-owner-id.mjs';

const seedSource = readFileSync(resolve(process.cwd(), 'scripts/seed-remote-demo.mjs'), 'utf8');

describe('remote demo vendor ownership', () => {
  it('matches the canonical PostgreSQL migration UUID format deterministically', () => {
    expect(vendorOwnerIdForSlug('rasa-malaysia')).toBe('c83b2bf7-1858-9593-5c05-5f77ed01c412');
    expect(vendorOwnerIdForSlug('explore-outdoors-malaysia')).toBe('8ad96846-ca78-2965-d611-2d5871595ff9');
    expect(vendorOwnerIdForSlug('rasa-malaysia')).toBe(vendorOwnerIdForSlug('rasa-malaysia'));
    expect(vendorOwnerIdForSlug('rasa-malaysia')).not.toBe(vendorOwnerIdForSlug('serenity-wellness-retreats'));
    expect(() => vendorOwnerIdForSlug('Not A Slug')).toThrow(/Invalid vendor slug/);
  });

  it('uses the canonical per-vendor owner identity for every seeded vendor group', () => {
    expect(seedSource).toContain("const RASA_VENDOR_SLUG = 'rasa-malaysia';");
    expect(seedSource).toContain('const RASA_OWNER_ID = vendorOwnerIdForSlug(RASA_VENDOR_SLUG);');
    expect(seedSource).toContain('owner_id: RASA_OWNER_ID');
    expect(seedSource).toContain('owner_id: vendor.ownerId');
    expect(seedSource).toContain('owner_id: tv.ownerId');
    for (const slug of [
      'explore-outdoors-malaysia',
      'warisan-cultural-journeys',
      'serenity-wellness-retreats',
      'kraftangan-artisan-market',
      'batik-nusantara',
      'borneo-wild',
    ]) {
      expect(seedSource).toContain(`vendorOwnerIdForSlug('${slug}')`);
    }
    expect(seedSource).not.toContain('owner_id: OWNER_ID');
    expect(seedSource).not.toContain('owner_id: DEMO_USERS[9][0]');
    expect(seedSource).not.toContain('ownerId: DEMO_USERS[8][0]');
    expect(seedSource).not.toContain('ownerId: DEMO_USERS[9][0]');
  });

  it('creates matching profile and owner-role records for themed vendors', () => {
    expect(seedSource).toContain('SEEDED_VENDOR_OWNER_PROFILES');
    expect(seedSource).toContain('id: vendorOwnerIdForSlug(slug)');
    expect(seedSource).toContain('seedRoles(vendor.id, outletRows.map((outlet) => outlet.id), vendor.ownerId, [])');
    expect(seedSource).toContain('seedRoles(tv.id, rows.map((outlet) => outlet.id), tv.ownerId, [])');
    expect(seedSource).toContain(".eq('vendor_id', vendorId)\n    .neq('user_id', ownerId)");
  });

  it('keeps Auth account provisioning separate from the remote data seed', () => {
    expect(seedSource).toContain("'vendor.owner@demo.local'");
    expect(seedSource).toContain('seed-demo-vendor-accounts.mjs');
    expect(seedSource).not.toContain('supabase.auth.admin.createUser');
    expect(seedSource).not.toContain("password: 'demo123456'");
    expect(seedSource).toContain('await upsert(\'users\', [...demoProfiles, ...SEEDED_VENDOR_OWNER_PROFILES]);');
  });

  it('does not seed server-managed verification facts', () => {
    expect(seedSource).not.toMatch(/\b(?:kyc_status|email_verified_at|phone_verified_at|profile_completed_at)\s*:/);
  });
});
