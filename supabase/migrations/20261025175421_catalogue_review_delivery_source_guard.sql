-- Only the staff catalogue RPC writes normalized decision names. Vendor-owned
-- voucher reviews write approve/reject and must not create owner notices.
CREATE OR REPLACE FUNCTION app_private.queue_catalogue_review_notices() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  recipient public.users%ROWTYPE;
  vendor public.vendors%ROWTYPE;
  action_name text;
  notice_body text;
  notice_title text;
  notice_link text;
  notice_key text;
BEGIN
  IF NEW.action IS NULL OR NEW.action NOT IN ('approved', 'rejected', 'change_requested') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO vendor FROM public.vendors WHERE id = NEW.vendor_id AND status = 'approved';
  IF NOT FOUND OR vendor.owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO recipient FROM public.users WHERE id = vendor.owner_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  action_name := CASE NEW.action
    WHEN 'approved' THEN 'approve'
    WHEN 'rejected' THEN 'reject'
    WHEN 'change_requested' THEN 'change_requested'
  END;
  notice_title := 'Listing ' || CASE NEW.action
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'changes requested'
  END;
  notice_body := 'Your ' || NEW.entity_type || ' review was ' || CASE NEW.action
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'returned for changes'
  END || CASE WHEN nullif(btrim(NEW.note), '') IS NULL
    THEN '.' ELSE ': ' || btrim(NEW.note) END;
  notice_link := CASE WHEN NEW.entity_type IN ('outlet', 'hotel_profile')
    THEN '/vendor/outlets' ELSE '/vendor/products' END;
  notice_key := 'listing:review:' || NEW.id || ':' || recipient.id;

  INSERT INTO public.notifications(user_id, vendor_id, outlet_id, audience_role, type, title, body, link, category, metadata, event_key)
  VALUES(recipient.id, NEW.vendor_id, NULL, 'vendor_owner', 'vendor_listing_' || action_name,
    notice_title, notice_body, notice_link, 'vendor_products',
    jsonb_build_object('entityType', NEW.entity_type, 'status', NEW.action, 'reviewId', NEW.id), notice_key)
  ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;

  IF nullif(btrim(recipient.email), '') IS NOT NULL THEN
    INSERT INTO public.email_outbox(event_key, user_id, to_email, event_type, payload, status, next_attempt_at)
    VALUES(notice_key, recipient.id, btrim(recipient.email), 'vendor_listing_review',
      jsonb_build_object('locale', coalesce(recipient.preferred_locale, 'en'), 'recipientName', recipient.full_name,
        'vendorName', vendor.name, 'reason', notice_body, 'reference', NEW.entity_id, 'occurredAt', NEW.created_at),
      'pending', now())
    ON CONFLICT(event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.queue_catalogue_review_notices() FROM PUBLIC, anon, authenticated, service_role;
