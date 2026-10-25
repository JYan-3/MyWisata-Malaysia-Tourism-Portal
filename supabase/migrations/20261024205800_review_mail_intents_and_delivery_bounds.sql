-- Review events and delivery intent commit together. No historical mail is replayed.
CREATE FUNCTION app_private.queue_recommendation_review_mail() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE recipient public.users%ROWTYPE; vendor_name text;
BEGIN
  IF NEW.action <> 'approve' OR NEW.to_status <> 'approved' THEN RETURN NEW; END IF;
  SELECT * INTO recipient FROM public.users WHERE id = NEW.recommender_id;
  -- Email remains optional for a legacy account without a contact address.
  IF NOT FOUND OR nullif(btrim(recipient.email), '') IS NULL THEN RETURN NEW; END IF;
  SELECT r.vendor_name INTO vendor_name FROM public.vendor_recommendations r WHERE r.id = NEW.recommendation_id;
  INSERT INTO public.email_outbox(event_key,user_id,to_email,event_type,payload,status,next_attempt_at)
  VALUES('recommendation_approved:' || NEW.recommendation_id,recipient.id,btrim(recipient.email),'recommendation_approved',
    jsonb_build_object('locale',coalesce(recipient.preferred_locale,'en'),'recipientName',recipient.full_name,
      'vendorName',vendor_name,'occurredAt',NEW.created_at),'pending',now())
  ON CONFLICT(event_key) DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.queue_recommendation_review_mail() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER recommendation_review_mail_intent AFTER INSERT ON public.recommendation_review_events
FOR EACH ROW EXECUTE FUNCTION app_private.queue_recommendation_review_mail();

CREATE FUNCTION app_private.queue_catalogue_review_notices() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE recipient public.users%ROWTYPE; vendor public.vendors%ROWTYPE; action_name text; notice_body text; notice_title text; notice_link text; notice_key text;
BEGIN
  IF NEW.action = 'submitted' THEN RETURN NEW; END IF;
  SELECT * INTO vendor FROM public.vendors WHERE id = NEW.vendor_id AND status = 'approved';
  IF NOT FOUND OR vendor.owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO recipient FROM public.users WHERE id = vendor.owner_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  action_name := CASE NEW.action WHEN 'approved' THEN 'approve' WHEN 'rejected' THEN 'reject' WHEN 'change_requested' THEN 'change_requested' END;
  IF action_name IS NULL THEN RAISE EXCEPTION 'unsupported_catalogue_review_action'; END IF;
  notice_title := 'Listing ' || CASE NEW.action WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'changes requested' END;
  notice_body := 'Your ' || NEW.entity_type || ' review was ' || CASE NEW.action WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'returned for changes' END
    || CASE WHEN nullif(btrim(NEW.note),'') IS NULL THEN '.' ELSE ': ' || btrim(NEW.note) END;
  notice_link := CASE WHEN NEW.entity_type IN ('outlet','hotel_profile') THEN '/vendor/outlets' ELSE '/vendor/products' END;
  notice_key := 'listing:review:' || NEW.id || ':' || recipient.id;
  INSERT INTO public.notifications(user_id,vendor_id,outlet_id,audience_role,type,title,body,link,category,metadata,event_key)
  VALUES(recipient.id,NEW.vendor_id,NULL,'vendor_owner','vendor_listing_' || action_name,notice_title,notice_body,notice_link,'vendor_products',
    jsonb_build_object('entityType',NEW.entity_type,'status',NEW.action,'reviewId',NEW.id),notice_key)
  ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;
  IF nullif(btrim(recipient.email),'') IS NOT NULL THEN
    INSERT INTO public.email_outbox(event_key,user_id,to_email,event_type,payload,status,next_attempt_at)
    VALUES(notice_key,recipient.id,btrim(recipient.email),'vendor_listing_review',
      jsonb_build_object('locale',coalesce(recipient.preferred_locale,'en'),'recipientName',recipient.full_name,
        'vendorName',vendor.name,'reason',notice_body,'reference',NEW.entity_id,'occurredAt',NEW.created_at),'pending',now())
    ON CONFLICT(event_key) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.queue_catalogue_review_notices() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER catalogue_review_delivery_intent AFTER INSERT ON public.content_reviews
FOR EACH ROW EXECUTE FUNCTION app_private.queue_catalogue_review_notices();

-- Every legacy/current claim path calls this helper. Serialise admission across workers.
CREATE OR REPLACE FUNCTION app_private.claim_receipt_aware_email_delivery(p_limit integer,p_include_receipts boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rows jsonb; recovered integer; review_count integer; occupied integer;
BEGIN
  PERFORM app_private.require_email_delivery_service();
  PERFORM pg_advisory_xact_lock(hashtextextended('email_delivery_global_admission',0));
  UPDATE public.email_outbox SET status='failed',delivery_state='unknown',last_error='email_delivery_unknown',
    lease_expires_at=coalesce(lease_expires_at,clock_timestamp()),updated_at=now()
  WHERE status<>'sent' AND delivery_state IN ('ready','in_flight')
    AND ((lease_token IS NOT NULL AND lease_expires_at<=now() AND delivery_started_at IS NOT NULL)
      OR (status='sending' AND lease_token IS NULL AND updated_at<now()-interval '15 minutes')
      OR (status='failed' AND lease_token IS NULL AND attempts>0));
  UPDATE public.email_outbox SET status='failed',delivery_state='ready',last_error='email_claim_interrupted',
    next_attempt_at=now(),updated_at=now(),lease_expires_at=NULL,lease_token=gen_random_uuid()
  WHERE status<>'sent' AND delivery_state='ready' AND delivery_started_at IS NULL
    AND lease_token IS NOT NULL AND lease_expires_at<=now();
  GET DIAGNOSTICS recovered=ROW_COUNT;
  -- An expired in-flight lease is not proof SMTP stopped. Reserve its slot until
  -- the original worker acknowledges or an administrator resolves the evidence.
  SELECT count(*) INTO occupied FROM public.email_outbox
  WHERE status='sending' OR (delivery_state='unknown' AND status<>'sent' AND lease_expires_at IS NOT NULL);
  WITH candidates AS (
    SELECT id FROM public.email_outbox WHERE status IN ('pending','failed') AND delivery_state='ready'
      AND attempts<5 AND next_attempt_at<=now()
      AND (p_include_receipts OR (payload->>'receiptOrderId' IS NULL AND NOT (payload ? 'guestAccessToken' AND coalesce(payload->>'reason','')='')))
    ORDER BY created_at,id LIMIT greatest(0,least(coalesce(p_limit,2),2,2-occupied)) FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.email_outbox e SET status='sending',attempts=e.attempts+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '15 minutes',delivery_started_at=NULL,
      smtp_message_id='<outbox-'||e.id::text||'@mylawatan.my>',updated_at=now()
    FROM candidates c WHERE e.id=c.id RETURNING e.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO rows FROM claimed;
  SELECT count(*) INTO review_count FROM public.email_outbox WHERE status<>'sent'
    AND (delivery_state='unknown' OR (status='failed' AND attempts>=5));
  RETURN jsonb_build_object('rows',rows,'recovered',recovered,'reviewRequired',review_count);
END; $$;
REVOKE ALL ON FUNCTION app_private.claim_receipt_aware_email_delivery(integer,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION app_private.email_delivery_queue_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_email_delivery_service();
  RETURN (SELECT jsonb_build_object(
    'pending',count(*) FILTER(WHERE status='pending' AND delivery_state='ready'),
    'sending',count(*) FILTER(WHERE status='sending'),
    'failed',count(*) FILTER(WHERE status='failed' AND delivery_state='ready' AND attempts<5),
    'reviewRequired',count(*) FILTER(WHERE status<>'sent' AND (delivery_state='unknown' OR attempts>=5)),
    'expiredSending',count(*) FILTER(WHERE status='sending' AND lease_expires_at<=now()),
    'oldestPendingSeconds',coalesce(extract(epoch FROM now()-min(created_at) FILTER(WHERE status IN ('pending','failed') AND delivery_state='ready' AND attempts<5)),0))
    FROM public.email_outbox);
END; $$;
REVOKE ALL ON FUNCTION app_private.email_delivery_queue_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.email_delivery_queue_health() TO service_role;
CREATE OR REPLACE FUNCTION public.portal_queue_health() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.portal_queue_health() || jsonb_build_object('email',app_private.email_delivery_queue_health());
$$;
REVOKE ALL ON FUNCTION public.portal_queue_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portal_queue_health() TO service_role;
NOTIFY pgrst,'reload schema';
