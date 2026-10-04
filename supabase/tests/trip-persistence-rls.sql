BEGIN;

CREATE TEMP TABLE trip_rls_fixture (
  owner_id UUID,
  other_id UUID,
  owner_trip_id TEXT DEFAULT gen_random_uuid()::text,
  other_trip_id TEXT DEFAULT gen_random_uuid()::text
);

INSERT INTO trip_rls_fixture (owner_id, other_id)
SELECT (array_agg(id ORDER BY id))[1], (array_agg(id ORDER BY id))[2]
FROM (SELECT id FROM auth.users ORDER BY created_at LIMIT 2) users;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM trip_rls_fixture WHERE owner_id IS NULL OR other_id IS NULL) THEN
    RAISE EXCEPTION 'trip_rls_test_requires_two_existing_auth_users';
  END IF;
END $$;

INSERT INTO public.trips (id, user_id, name, start_date, end_date)
SELECT owner_trip_id, owner_id, 'Rollback trip owner fixture', DATE '2026-10-10', DATE '2026-10-11'
FROM trip_rls_fixture
UNION ALL
SELECT other_trip_id, other_id, 'Rollback trip other fixture', DATE '2026-10-10', DATE '2026-10-11'
FROM trip_rls_fixture;

INSERT INTO public.trip_items (trip_id, sequence, source, kind, lat, lng, label)
SELECT owner_trip_id, 0, 'location', 'custom', 3.139, 101.687, 'Rollback owner stop'
FROM trip_rls_fixture;

GRANT SELECT ON trip_rls_fixture TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', owner_id::text, true) FROM trip_rls_fixture;

DO $$
DECLARE
  visible_trips INTEGER;
  visible_items INTEGER;
BEGIN
  SELECT count(*) INTO visible_trips FROM public.trips
  WHERE id IN (SELECT owner_trip_id FROM trip_rls_fixture);
  SELECT count(*) INTO visible_items FROM public.trip_items
  WHERE trip_id IN (SELECT owner_trip_id FROM trip_rls_fixture);
  IF visible_trips <> 1 OR visible_items <> 1 THEN
    RAISE EXCEPTION 'trip_owner_read_failed: trips %, items %', visible_trips, visible_items;
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', other_id::text, true) FROM trip_rls_fixture;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.trips t CROSS JOIN trip_rls_fixture f WHERE t.id = f.owner_trip_id
  ) OR EXISTS (
    SELECT 1 FROM public.trip_items i CROSS JOIN trip_rls_fixture f WHERE i.trip_id = f.owner_trip_id
  ) THEN
    RAISE EXCEPTION 'trip_other_user_data_visible';
  END IF;
END $$;

ROLLBACK;

SELECT 'trip_persistence_owner_rls_passed' AS result;
