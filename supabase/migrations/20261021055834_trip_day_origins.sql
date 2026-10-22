-- Explicit overrides only: old location rows keep their existing semantics.
ALTER TABLE public.trip_items
  ADD COLUMN is_day_origin boolean NOT NULL DEFAULT false;

ALTER TABLE public.trip_items
  ADD CONSTRAINT trip_items_daily_origin_location CHECK (
    NOT is_day_origin OR (
      source = 'location' AND experience_id IS NULL AND scheduled_date IS NOT NULL
    )
  );

CREATE UNIQUE INDEX trip_items_one_origin_per_day
  ON public.trip_items (trip_id, scheduled_date)
  WHERE is_day_origin;

COMMENT ON COLUMN public.trip_items.is_day_origin IS
  'Explicit start for scheduled_date; false preserves legacy global-location behavior. Owner RLS remains unchanged.';
