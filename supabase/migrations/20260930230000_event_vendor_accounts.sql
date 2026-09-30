-- Phase 4 of Docs/plans/2026-09-30-1829-event-vendor-reservations.md.
-- Event vendor accounts: a separate role, admin-issued email invites that are
-- not tied to a customer recommendation, a claim that creates an event vendor
-- with no outlet, KYC-gated approval, and a database-level guarantee that
-- event vendors never own shop resources (outlets, products, vouchers, paid
-- event promotions) whichever path writes them.

-- ── Role ──────────────────────────────────────────────────────────────────

INSERT INTO public.roles (name, description)
SELECT 'event_vendor', 'Vendor that sells only at events; never listed as a normal shop'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'event_vendor');

-- ── A vendor's kind never changes after creation ──────────────────────────
-- Switching kind would either expose an event vendor as a shop or leave a
-- shop's outlets/products under an event vendor.

CREATE OR REPLACE FUNCTION public.keep_vendor_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'vendor_kind_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendors_keep_kind ON public.vendors;
CREATE TRIGGER vendors_keep_kind
  BEFORE UPDATE OF kind ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.keep_vendor_kind();

-- ── Event vendors never own shop resources ────────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_event_vendor_shop_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = NEW.vendor_id AND v.kind = 'event') THEN
    RAISE EXCEPTION 'event_vendor_not_allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_event_vendor_shop_rows() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS outlets_reject_event_vendor ON public.outlets;
CREATE TRIGGER outlets_reject_event_vendor
  BEFORE INSERT OR UPDATE OF vendor_id ON public.outlets
  FOR EACH ROW EXECUTE FUNCTION public.reject_event_vendor_shop_rows();

DROP TRIGGER IF EXISTS products_reject_event_vendor ON public.products;
CREATE TRIGGER products_reject_event_vendor
  BEFORE INSERT OR UPDATE OF vendor_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.reject_event_vendor_shop_rows();

DROP TRIGGER IF EXISTS vouchers_reject_event_vendor ON public.vouchers;
CREATE TRIGGER vouchers_reject_event_vendor
  BEFORE INSERT OR UPDATE OF vendor_id ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.reject_event_vendor_shop_rows();

DROP TRIGGER IF EXISTS vendor_event_promotions_reject_event_vendor ON public.vendor_event_promotions;
CREATE TRIGGER vendor_event_promotions_reject_event_vendor
  BEFORE INSERT OR UPDATE OF vendor_id ON public.vendor_event_promotions
  FOR EACH ROW EXECUTE FUNCTION public.reject_event_vendor_shop_rows();

-- ── Invites: event invites carry a business name instead of a recommendation ──

ALTER TABLE public.vendor_recommendation_invites
  ALTER COLUMN recommendation_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS vendor_kind TEXT NOT NULL DEFAULT 'shop',
  ADD COLUMN IF NOT EXISTS business_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_recommendation_invites_kind_check') THEN
    ALTER TABLE public.vendor_recommendation_invites ADD CONSTRAINT vendor_recommendation_invites_kind_check CHECK (
      (vendor_kind = 'shop' AND recommendation_id IS NOT NULL)
      OR (vendor_kind = 'event' AND recommendation_id IS NULL
          AND business_name IS NOT NULL AND char_length(btrim(business_name)) BETWEEN 2 AND 120)
    );
  END IF;
END $$;

-- ── Claim an event vendor invite: vendor (kind 'event', pending), no outlet ──

CREATE OR REPLACE FUNCTION public.claim_event_vendor_invite(
  p_token_hash TEXT,
  p_business_name TEXT,
  p_legal_business_name TEXT,
  p_description TEXT,
  p_contact_email TEXT,
  p_contact_phone TEXT,
  p_business_address TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user public.users%ROWTYPE;
  v_invite public.vendor_recommendation_invites%ROWTYPE;
  v_base_slug TEXT;
  v_slug TEXT;
  v_suffix INTEGER := 1;
  v_vendor_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('claim_vendor_recommendation'), hashtext(v_user_id::TEXT));

  SELECT u.* INTO v_user FROM public.users u WHERE u.id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF v_user.phone_verified_at IS NULL THEN
    RAISE EXCEPTION 'phone_verification_required';
  END IF;

  SELECT i.* INTO v_invite FROM public.vendor_recommendation_invites i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_invite.vendor_kind <> 'event' THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;
  IF v_invite.status = 'cancelled' THEN
    RAISE EXCEPTION 'invite_cancelled';
  END IF;
  IF v_invite.status = 'expired' OR v_invite.expires_at <= NOW() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;
  IF v_invite.status <> 'invited' THEN
    RAISE EXCEPTION 'invite_already_claimed';
  END IF;

  IF NULLIF(lower(BTRIM(v_user.email)), '') IS NULL
     OR NULLIF(lower(BTRIM(v_invite.email)), '') IS NULL
     OR NULLIF(lower(BTRIM(p_contact_email)), '') IS NULL
     OR lower(BTRIM(v_user.email)) <> lower(BTRIM(v_invite.email))
     OR lower(BTRIM(v_user.email)) <> lower(BTRIM(p_contact_email)) THEN
    RAISE EXCEPTION 'email_mismatch';
  END IF;

  IF EXISTS (SELECT 1 FROM public.vendors v WHERE v.owner_id = v_user_id AND v.status IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'owner_already_has_vendor';
  END IF;

  IF char_length(BTRIM(COALESCE(p_business_name, ''))) NOT BETWEEN 2 AND 120
     OR char_length(BTRIM(COALESCE(p_legal_business_name, ''))) NOT BETWEEN 2 AND 200
     OR char_length(BTRIM(COALESCE(p_description, ''))) NOT BETWEEN 10 AND 2000
     OR char_length(BTRIM(COALESCE(p_business_address, ''))) NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'claim_details_invalid';
  END IF;

  v_base_slug := LEFT(COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(lower(p_business_name), '[^a-z0-9]+', '-', 'g')), ''), 'event-vendor'), 100);
  LOOP
    v_slug := CASE WHEN v_suffix = 1 THEN v_base_slug
      ELSE LEFT(v_base_slug, 100 - char_length(v_suffix::TEXT) - 1) || '-' || v_suffix END;
    BEGIN
      INSERT INTO public.vendors (owner_id, name, slug, description, kind, status)
      VALUES (v_user_id, BTRIM(p_business_name), v_slug, BTRIM(p_description), 'event', 'pending')
      RETURNING id INTO v_vendor_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF EXISTS (SELECT 1 FROM public.vendors v WHERE v.slug = v_slug) THEN
        v_suffix := v_suffix + 1;
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;

  INSERT INTO public.vendor_onboarding_profiles (
    vendor_id, legal_business_name, contact_email, contact_phone, business_address, status
  ) VALUES (
    v_vendor_id, BTRIM(p_legal_business_name), lower(BTRIM(p_contact_email)),
    NULLIF(BTRIM(p_contact_phone), ''), BTRIM(p_business_address), 'submitted'
  );

  UPDATE public.vendor_recommendation_invites
     SET status = 'claimed', claimed_vendor_id = v_vendor_id, claimed_at = NOW()
   WHERE id = v_invite.id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  VALUES (v_user_id, 'vendor.event_invite_claimed', 'vendor', v_vendor_id,
          jsonb_build_object('invite_id', v_invite.id, 'kind', 'event', 'status', 'pending'));

  RETURN jsonb_build_object('vendor_id', v_vendor_id, 'status', 'pending', 'kind', 'event');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_event_vendor_invite(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_event_vendor_invite(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ── Approval: event vendors need the owner's KYC and get the event_vendor role ──
-- Same signature as before — true CREATE OR REPLACE. Shop behaviour unchanged.

CREATE OR REPLACE FUNCTION public.admin_approve_claimed_vendor(p_vendor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id UUID := auth.uid();
  v_vendor public.vendors%ROWTYPE;
  v_claim_recommendation_id UUID;
  v_role_name TEXT;
  v_owner_role_id INTEGER;
  v_conversion_id UUID;
BEGIN
  IF v_actor_id IS NULL OR NOT public.has_staff_permission(v_actor_id, 'admin.vendor.manage') THEN
    RAISE EXCEPTION 'vendor_permission_required';
  END IF;

  SELECT *
    INTO v_vendor
    FROM public.vendors
   WHERE id = p_vendor_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor_not_found';
  END IF;
  IF v_vendor.status NOT IN ('pending', 'rejected') THEN
    RAISE EXCEPTION 'vendor_not_approvable';
  END IF;

  -- Event vendors take pre-payments: the owner's identity must be verified first.
  IF v_vendor.kind = 'event' AND NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = v_vendor.owner_id AND u.kyc_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'owner_kyc_required';
  END IF;

  SELECT recommendation_id
    INTO v_claim_recommendation_id
    FROM public.vendor_recommendation_claims
   WHERE vendor_id = p_vendor_id
   FOR UPDATE;

  UPDATE public.vendors
     SET status = 'approved',
         approved_by = v_actor_id,
         approved_at = NOW(),
         rejection_reason = NULL
   WHERE id = p_vendor_id;

  INSERT INTO public.vendor_onboarding_profiles (
    vendor_id, status, review_note, reviewed_by, reviewed_at, updated_at
  ) VALUES (
    p_vendor_id, 'approved', NULL, v_actor_id, NOW(), NOW()
  )
  ON CONFLICT (vendor_id) DO UPDATE SET
    status = EXCLUDED.status,
    review_note = NULL,
    reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at,
    updated_at = EXCLUDED.updated_at;

  v_role_name := CASE WHEN v_vendor.kind = 'event' THEN 'event_vendor' ELSE 'vendor_owner' END;
  SELECT id
    INTO v_owner_role_id
    FROM public.roles
   WHERE name = v_role_name;
  IF v_owner_role_id IS NULL THEN
    RAISE EXCEPTION 'vendor_owner_role_missing';
  END IF;

  INSERT INTO public.user_roles (user_id, role_id, vendor_id, outlet_id)
  SELECT v_vendor.owner_id, v_owner_role_id, p_vendor_id, NULL
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.user_roles
     WHERE user_id = v_vendor.owner_id
       AND role_id = v_owner_role_id
       AND vendor_id = p_vendor_id
       AND outlet_id IS NULL
  );

  IF v_claim_recommendation_id IS NOT NULL THEN
    v_conversion_id := public.convert_claimed_vendor_recommendation(
      p_vendor_id,
      v_claim_recommendation_id
    );
  END IF;

  RETURN jsonb_build_object(
    'vendor_id', p_vendor_id,
    'status', 'approved',
    'converted', v_claim_recommendation_id IS NOT NULL,
    'recommendation_id', v_claim_recommendation_id,
    'conversion_id', v_conversion_id
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
