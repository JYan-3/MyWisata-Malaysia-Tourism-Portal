import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

const privateTables = [
  "capabilities",
  "content_translation_generation_locks",
  "entitlement_assignments",
  "entitlement_generation",
  "entitlement_policies",
  "entitlement_policy_approvals",
  "entitlement_policy_requirements",
  "entitlement_policy_versions",
  "geocode_cache",
  "kyc_ocr_results",
  "kyc_review_events",
  "kyc_submission_documents",
  "location_cities",
  "payout_provider_events",
  "payout_transactions",
  "platform_settings",
  "promotion_campaign_vendor_review_events",
  "recommendation_review_events",
  "recommendation_snapshots",
  "sponsored_discovery_events",
  "staff_invitations",
  "sync_outbox",
  "tng_mock_callback_outbox",
  "vendor_event_promotion_review_events",
  "voucher_store_redemptions",
];

describe("production Security Advisor remediation migrations", () => {
  it("preserves service-only ACLs and removes anonymous access from other definer RPCs", () => {
    const sql = migration("harden_exposed_definer_rpcs");

    expect(sql).toContain("has_function_privilege('anon'");
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION");
    expect(sql).toContain("apply_external_reservation");
    expect(sql).toContain("credit_pending_recommendation");
    expect(sql).toContain("record_withdrawal_payout_failure");
    expect(sql).toContain("cancel_withdrawal");
    expect(sql).toContain("complete_withdrawal");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("get_public_promotion_campaigns");
    expect(sql).toContain("get_event_pickup_availability");
    expect(sql).toContain("list_active_sponsored_discovery_placements");
    expect(sql).toContain("record_sponsored_discovery_event");
    expect(sql).toContain("cardinality(policy.polroles) = 0");
    expect(sql).toContain("WHEN auth.role() = 'anon' THEN false");
    expect(sql).toContain("ALTER TABLE public.product_merge_map ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.product_merge_map FROM PUBLIC, anon, authenticated");
    expect(sql).toMatch(/product_merge_map[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/i);

    for (const table of privateTables) expect(sql).toContain(`'${table}'`);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*?FOR ALL TO anon, authenticated[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/i);
    expect(sql).not.toMatch(/GRANT\s+(?:SELECT|ALL)[\s\S]*?TO\s+(?:anon|authenticated)/i);
  });

  it("keeps public profile fields allow-listed under invoker security", () => {
    const sql = migration("make_advisor_views_safe");

    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS app_private");
    expect(sql).toContain("app_private.public_user_profiles");
    expect(sql).toContain("sync_public_user_profile");
    expect(sql).toContain("CREATE OR REPLACE VIEW public.public_users");
    expect(sql).toMatch(/public_users[\s\S]*?security_invoker\s*=\s*true/i);
    expect(sql).toContain("ALTER VIEW public.product_review_metrics SET (security_invoker = true)");
    expect(sql).toContain("DROP POLICY IF EXISTS demo_accounts_anon_read ON public.users");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon");
    expect(sql).toContain("is_kyc_verified");
    expect(sql).toContain("has_completed_profile");
    expect(sql).not.toMatch(/SELECT\s+\*\s+FROM\s+public\.users/i);
  });

  it("fixes every flagged function path and relocates vector without changing its OID consumers", () => {
    const sql = migration("harden_function_search_paths_and_vector");
    const flaggedFunctions = [
      "set_updated_at", "match_kb_documents", "normalize_vendor_name", "whoami",
      "recalculate_wallet_balance", "is_super_admin", "approve_withdrawal", "review_kyc",
      "convert_recommendation", "auto_upgrade_to_profile_complete", "request_withdrawal",
      "generate_product_display_id", "generate_outlet_display_id", "generate_order_display_id",
      "generate_booking_display_id", "cancel_withdrawal", "complete_withdrawal",
      "admin_set_processing", "record_admin_approval", "credit_pending_recommendation",
      "admin_reject_withdrawal", "round_sen", "tier_rank", "check_phone_collision",
      "derive_initial_user_tier", "admin_set_tier", "normalize_wallet_notification_category",
      "admin_conduct_flags_append_only", "touch_vendor_suggestions_updated_at",
    ];

    expect(sql).toContain("ALTER EXTENSION vector SET SCHEMA extensions");
    expect(sql).toContain("ALTER FUNCTION public.match_kb_documents(extensions.vector, integer)");
    expect(sql).toMatch(/SET search_path = public, extensions, pg_temp/i);
    for (const name of flaggedFunctions) expect(sql).toContain(name);
  });
});
