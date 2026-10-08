-- Minimal local-only support schema for event-management integration tests.
-- The runner applies this after the repository's base marketplace migration.
-- It intentionally omits application data and never contains remote credentials.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- The selected event migrations read these catalogue columns while defining
-- their existing public projection. They are not used to create test offers.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'approved';
ALTER TABLE public.outlets
  ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'approved';
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS kind text DEFAULT 'other';
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS vendor_review_status text DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS is_claimable boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS redemption_mode text DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS reserved_uses integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_from timestamptz,
  ADD COLUMN IF NOT EXISTS claim_until timestamptz,
  ADD COLUMN IF NOT EXISTS product_id uuid;

CREATE TABLE IF NOT EXISTS public.outlet_offers (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES public.outlets(id) ON DELETE CASCADE,
  price numeric NOT NULL,
  status text NOT NULL DEFAULT 'active',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, outlet_id)
);

-- Only the columns written by the campaign migration are needed here. The
-- real staff migrations are intentionally outside this bounded fixture.
CREATE TABLE IF NOT EXISTS public.staff_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  module text NOT NULL,
  action text NOT NULL,
  description text NOT NULL,
  is_system boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_role_permissions (
  role_id uuid NOT NULL REFERENCES public.staff_roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.staff_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS public.staff_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  label_key text,
  description text,
  section_key text NOT NULL,
  section_label text NOT NULL,
  section_label_key text,
  section_sort_order integer NOT NULL DEFAULT 0,
  href text UNIQUE NOT NULL,
  icon_key text NOT NULL DEFAULT 'activity',
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_module_permissions (
  module_id uuid NOT NULL REFERENCES public.staff_modules(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.staff_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (module_id, permission_id)
);
CREATE TABLE IF NOT EXISTS public.staff_role_modules (
  role_id uuid NOT NULL REFERENCES public.staff_roles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.staff_modules(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, module_id)
);

CREATE OR REPLACE FUNCTION public.has_staff_permission(
  p_user_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND EXISTS (
       SELECT 1 FROM public.users
        WHERE id = p_user_id AND status = 'active'
     );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id = '00000000-0000-0000-0000-000000000001'::uuid;
$$;

CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  cart_id uuid,
  order_id uuid,
  payment_method text,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  subtotal numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_payment',
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.checkout_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id uuid NOT NULL REFERENCES public.checkout_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'inventory',
  variant_id uuid,
  slot_id uuid,
  quantity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'held',
  outlet_id uuid,
  cart_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The historical base schema uses upper-case order statuses while the event
-- migrations use lower-case values. Keep both spellings in this disposable DB.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check,
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (
    status IN ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'COMPLETED', 'CANCELLED',
               'draft', 'pending_payment', 'paid', 'completed', 'cancelled')
  );
ALTER TABLE public.order_items
  ALTER COLUMN outlet_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT email_outbox_event_type_check CHECK (
    event_type IN (
      'order_confirmation', 'booking_confirmation', 'order_cancelled',
      'vendor_order_update', 'vendor_booking_update', 'vendor_listing_review',
      'vendor_wallet_update', 'vendor_account_update', 'vendor_permission_update',
      'recommendation_approved', 'recommendation_rejected', 'kyc_approved',
      'kyc_rejected', 'withdrawal_approved', 'withdrawal_rejected'
    )
  )
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vendor_id uuid,
  ADD COLUMN IF NOT EXISTS outlet_id uuid,
  ADD COLUMN IF NOT EXISTS audience_role text;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_event_key_unique UNIQUE (event_key);
