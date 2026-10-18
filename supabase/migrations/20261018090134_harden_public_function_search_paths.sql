-- Harden the public wrappers exposed through Supabase RPC.
-- The implementation functions already pin their own search_path; these public
-- entry points must pin it as well so name resolution cannot be changed by a
-- caller-controlled session setting.

ALTER FUNCTION public.apply_hotel_profile_submission(uuid, uuid, timestamptz)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.ensure_stay_nights(integer)
  SET search_path = public, pg_temp;
