-- Customer itineraries are account-owned records, not browser-cookie demos.
CREATE TABLE IF NOT EXISTS public.trips (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_id TEXT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS trips_user_legacy_id_key
  ON public.trips(user_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_user_created_idx
  ON public.trips(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.trip_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  trip_id TEXT NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  legacy_id TEXT,
  experience_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  scheduled_date DATE,
  scheduled_time TIME,
  source TEXT NOT NULL DEFAULT 'vendor' CHECK (source IN ('vendor', 'location')),
  kind TEXT CHECK (kind IS NULL OR kind IN ('custom', 'gps')),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  sublabel TEXT CHECK (sublabel IS NULL OR char_length(sublabel) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trip_items_trip_legacy_id_key
  ON public.trip_items(trip_id, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_items_trip_sequence_idx
  ON public.trip_items(trip_id, sequence, created_at);

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trips_owner_all ON public.trips;
CREATE POLICY trips_owner_all ON public.trips
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS trip_items_owner_all ON public.trip_items;
CREATE POLICY trip_items_owner_all ON public.trip_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_items.trip_id AND t.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = trip_items.trip_id AND t.user_id = (SELECT auth.uid())
  ));

REVOKE ALL ON TABLE public.trips, public.trip_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trips, public.trip_items TO authenticated, service_role;

-- A worker crash can leave an event in processing forever. An expiring lease
-- makes that event safely claimable again after the dispatcher timeout.
ALTER TABLE public.sync_outbox
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

UPDATE public.sync_outbox
SET status = 'failed',
    last_error = COALESCE(last_error, 'retry_limit_reached_after_stale_processing'),
    lease_expires_at = NULL
WHERE status = 'processing' AND retry_count >= 5;

UPDATE public.sync_outbox
SET lease_expires_at = created_at
WHERE status = 'processing' AND retry_count < 5 AND lease_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS sync_outbox_expired_lease_idx
  ON public.sync_outbox(lease_expires_at) WHERE status = 'processing';
