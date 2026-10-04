-- Preserve the public user-card contract while making its view invoker-secure.
-- The projection contains only fields already exposed by public.public_users.
CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;

CREATE TABLE app_private.public_user_profiles (
  id UUID PRIMARY KEY,
  full_name VARCHAR(255),
  display_name VARCHAR(100),
  avatar_url TEXT,
  city VARCHAR(100),
  country VARCHAR(100),
  is_kyc_verified BOOLEAN NOT NULL,
  has_completed_profile BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  bio TEXT
);

ALTER TABLE app_private.public_user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_user_profiles_select_public
  ON app_private.public_user_profiles
  FOR SELECT TO anon, authenticated, service_role
  USING (true);

REVOKE ALL ON TABLE app_private.public_user_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE app_private.public_user_profiles TO anon, authenticated, service_role;

CREATE FUNCTION app_private.sync_public_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM app_private.public_user_profiles WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.status = 'active' THEN
    INSERT INTO app_private.public_user_profiles (
      id, full_name, display_name, avatar_url, city, country,
      is_kyc_verified, has_completed_profile, created_at, bio
    ) VALUES (
      NEW.id, NEW.full_name, NEW.display_name, NEW.avatar_url, NEW.city, NEW.country,
      NEW.kyc_status = 'approved', NEW.profile_completed_at IS NOT NULL, NEW.created_at, NEW.bio
    )
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      city = EXCLUDED.city,
      country = EXCLUDED.country,
      is_kyc_verified = EXCLUDED.is_kyc_verified,
      has_completed_profile = EXCLUDED.has_completed_profile,
      created_at = EXCLUDED.created_at,
      bio = EXCLUDED.bio;
  ELSE
    DELETE FROM app_private.public_user_profiles WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.sync_public_user_profile() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER sync_public_user_profile_insert_delete
  AFTER INSERT OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION app_private.sync_public_user_profile();

CREATE TRIGGER sync_public_user_profile_update
  AFTER UPDATE OF full_name, display_name, avatar_url, city, country,
    kyc_status, profile_completed_at, created_at, bio, status
  ON public.users
  FOR EACH ROW EXECUTE FUNCTION app_private.sync_public_user_profile();

INSERT INTO app_private.public_user_profiles (
  id, full_name, display_name, avatar_url, city, country,
  is_kyc_verified, has_completed_profile, created_at, bio
)
SELECT
  id, full_name, display_name, avatar_url, city, country,
  kyc_status = 'approved', profile_completed_at IS NOT NULL, created_at, bio
FROM public.users
WHERE status = 'active'
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  display_name = EXCLUDED.display_name,
  avatar_url = EXCLUDED.avatar_url,
  city = EXCLUDED.city,
  country = EXCLUDED.country,
  is_kyc_verified = EXCLUDED.is_kyc_verified,
  has_completed_profile = EXCLUDED.has_completed_profile,
  created_at = EXCLUDED.created_at,
  bio = EXCLUDED.bio;

CREATE OR REPLACE VIEW public.public_users WITH (security_invoker = true) AS
SELECT
  id,
  full_name,
  display_name,
  avatar_url,
  city,
  country,
  is_kyc_verified,
  has_completed_profile,
  created_at,
  bio
FROM app_private.public_user_profiles;

ALTER VIEW public.public_users OWNER TO postgres;
GRANT SELECT ON public.public_users TO anon, authenticated, service_role;

-- This view reads the same visible-review set as reviews_public_read.
ALTER VIEW public.product_review_metrics SET (security_invoker = true);
GRANT SELECT ON public.product_review_metrics TO anon, authenticated, service_role;

-- Demo-account listing now uses the server-side service client. Remove every
-- remaining anonymous privilege on users, including column-level grants.
DROP POLICY IF EXISTS demo_accounts_anon_read ON public.users;
REVOKE ALL PRIVILEGES ON TABLE public.users FROM anon;

DO $revoke_user_columns$
DECLARE
  v_columns TEXT;
BEGIN
  SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
    INTO v_columns
  FROM pg_attribute
  WHERE attrelid = 'public.users'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.users FROM anon',
      v_columns
    );
  END IF;
END;
$revoke_user_columns$;
