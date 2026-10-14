-- Remember which outlet a trip stop was planned at, so the trip planner's Buy
-- button, time choices and slot lookup use that outlet instead of whichever
-- outlet search ranks first later. See
-- Docs/plans/2026-10-14-0055-trip-time-slots-and-outlet.md.

ALTER TABLE public.trip_items
  ADD COLUMN IF NOT EXISTS outlet_id UUID REFERENCES public.outlets(id) ON DELETE SET NULL;

-- Existing vendor stops stored the outlet's coordinates when added: match them
-- back to an outlet that sells the product. Stops that don't match stay NULL
-- and keep using the product's representative outlet.
UPDATE public.trip_items ti
   SET outlet_id = o.id
  FROM public.outlets o
 WHERE ti.outlet_id IS NULL
   AND ti.source = 'vendor'
   AND ti.experience_id IS NOT NULL
   AND abs(o.lat::double precision - ti.lat) < 0.000001
   AND abs(o.lng::double precision - ti.lng) < 0.000001
   AND (
     EXISTS (SELECT 1 FROM public.outlet_offers oo WHERE oo.product_id = ti.experience_id AND oo.outlet_id = o.id)
     OR EXISTS (SELECT 1 FROM public.products p WHERE p.id = ti.experience_id AND p.outlet_id = o.id)
   );
