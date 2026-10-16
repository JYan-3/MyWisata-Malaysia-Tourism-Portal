-- Public machine translations use their own cache and queue. The legacy
-- content_translations table remains the reviewed recommendation-draft store.

CREATE TABLE IF NOT EXISTS public.public_content_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'product', 'place', 'place_informational_activity', 'review', 'promotion_campaign'
  )),
  entity_key TEXT NOT NULL CHECK (length(entity_key) BETWEEN 1 AND 120),
  field TEXT NOT NULL CHECK (field IN (
    'name', 'description', 'tagline', 'intro', 'title', 'body', 'summary'
  )),
  locale TEXT NOT NULL CHECK (locale IN ('en', 'zh-CN', 'ms')),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  translated_text TEXT NOT NULL CHECK (length(btrim(translated_text)) BETWEEN 1 AND 5000),
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_key, field, locale, source_hash)
);

CREATE INDEX IF NOT EXISTS public_content_translations_lookup_idx
  ON public.public_content_translations(entity_type, entity_key, locale, field, source_hash);

CREATE TABLE IF NOT EXISTS public.content_translation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'product', 'place', 'place_informational_activity', 'review', 'promotion_campaign'
  )),
  entity_key TEXT NOT NULL CHECK (length(entity_key) BETWEEN 1 AND 120),
  field TEXT NOT NULL CHECK (field IN (
    'name', 'description', 'tagline', 'intro', 'title', 'body', 'summary'
  )),
  locale TEXT NOT NULL CHECK (locale IN ('en', 'zh-CN', 'ms')),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z_]{1,50}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (entity_type, entity_key, field, locale, source_hash)
);

CREATE INDEX IF NOT EXISTS content_translation_jobs_claim_idx
  ON public.content_translation_jobs(status, available_at, created_at)
  WHERE status IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS public.content_translation_backfill_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  cursor_entity_type TEXT NOT NULL DEFAULT '',
  cursor_entity_key TEXT NOT NULL DEFAULT '',
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.content_translation_backfill_state(singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.public_content_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_translation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_content_translations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.content_translation_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.public_content_translations TO service_role;
GRANT ALL ON TABLE public.content_translation_jobs TO service_role;
ALTER TABLE public.content_translation_backfill_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.content_translation_backfill_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.content_translation_backfill_state TO service_role;

CREATE OR REPLACE FUNCTION app_private.require_content_translation_service()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.queue_public_content_translation(
  p_entity_type TEXT,
  p_entity_key TEXT,
  p_field TEXT,
  p_locale TEXT,
  p_source_hash TEXT,
  p_max_backlog INTEGER DEFAULT 5000
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_field_allowed BOOLEAN;
BEGIN
  -- Serialize admission checks so concurrent enqueue requests cannot exceed
  -- the global pending-work ceiling.
  PERFORM pg_advisory_xact_lock(hashtext('public_content_translation_queue'));
  IF p_entity_type NOT IN ('product', 'place', 'place_informational_activity', 'review', 'promotion_campaign')
     OR p_locale NOT IN ('en', 'zh-CN', 'ms')
     OR p_entity_key IS NULL OR length(p_entity_key) NOT BETWEEN 1 AND 120
     OR p_source_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN FALSE;
  END IF;

  v_field_allowed := CASE p_entity_type
    WHEN 'product' THEN p_field IN ('name', 'description')
    WHEN 'place' THEN p_field IN ('name', 'tagline', 'intro')
    WHEN 'place_informational_activity' THEN p_field IN ('title', 'description')
    WHEN 'review' THEN p_field IN ('title', 'body')
    WHEN 'promotion_campaign' THEN p_field IN ('title', 'summary', 'description')
    ELSE FALSE
  END;
  IF NOT v_field_allowed THEN RETURN FALSE; END IF;

  IF (SELECT count(*) FROM public.content_translation_jobs WHERE status IN ('queued', 'processing')) >= greatest(1, least(coalesce(p_max_backlog, 5000), 20000)) THEN
    RETURN FALSE;
  END IF;

  UPDATE public.content_translation_jobs
     SET status = 'superseded', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE entity_type = p_entity_type AND entity_key = p_entity_key
     AND field = p_field AND locale = p_locale AND source_hash <> p_source_hash
     AND status IN ('queued', 'processing');

  INSERT INTO public.content_translation_jobs(entity_type, entity_key, field, locale, source_hash)
  VALUES (p_entity_type, p_entity_key, p_field, p_locale, p_source_hash)
  ON CONFLICT (entity_type, entity_key, field, locale, source_hash)
  DO UPDATE SET status = 'queued', attempts = 0, available_at = now(), lease_token = NULL,
                lease_expires_at = NULL, last_error_code = NULL, completed_at = NULL, updated_at = now()
    WHERE content_translation_jobs.status IN ('failed', 'superseded', 'completed')
      AND NOT EXISTS (
        SELECT 1
        FROM public.public_content_translations AS cached
        WHERE cached.entity_type = EXCLUDED.entity_type
          AND cached.entity_key = EXCLUDED.entity_key
          AND cached.field = EXCLUDED.field
          AND cached.locale = EXCLUDED.locale
          AND cached.source_hash = EXCLUDED.source_hash
      );
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_content_translation_jobs(p_jobs JSONB, p_max_backlog INTEGER DEFAULT 5000)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job JSONB;
  v_inserted INTEGER := 0;
BEGIN
  PERFORM app_private.require_content_translation_service();
  IF jsonb_typeof(p_jobs) <> 'array' OR jsonb_array_length(p_jobs) > 100 THEN
    RAISE EXCEPTION 'invalid_translation_jobs';
  END IF;

  FOR v_job IN SELECT value FROM jsonb_array_elements(p_jobs) AS value LOOP
    IF app_private.queue_public_content_translation(
      v_job->>'entity_type', v_job->>'entity_key', v_job->>'field',
      v_job->>'locale', v_job->>'source_hash', p_max_backlog
    ) THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_public_content_translation_jobs(p_limit INTEGER DEFAULT 50)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state public.content_translation_backfill_state%ROWTYPE;
  v_item RECORD;
  v_field TEXT;
  v_locale TEXT;
  v_source TEXT;
  v_limit INTEGER := greatest(1, least(coalesce(p_limit, 50), 100));
  v_processed INTEGER := 0;
  v_queue_full BOOLEAN := FALSE;
BEGIN
  PERFORM app_private.require_content_translation_service();
  SELECT * INTO v_state FROM public.content_translation_backfill_state WHERE singleton = TRUE FOR UPDATE;
  IF v_state.completed OR v_state.paused THEN RETURN 0; END IF;

  FOR v_item IN
    SELECT candidate.entity_type, candidate.entity_key, candidate.fields
      FROM (
        SELECT 'product'::TEXT AS entity_type, id::TEXT AS entity_key,
               jsonb_build_object('name', name, 'description', description) AS fields
          FROM public.products WHERE status = 'active' AND review_status = 'approved'
        UNION ALL
        SELECT 'place', id::TEXT, jsonb_build_object('name', name, 'tagline', tagline, 'intro', intro)
          FROM public.places WHERE status = 'active'
        UNION ALL
        SELECT 'place_informational_activity', id::TEXT, jsonb_build_object('title', title, 'description', description)
          FROM public.place_informational_activities WHERE status = 'active'
        UNION ALL
        SELECT 'promotion_campaign', campaign->>'id',
               jsonb_build_object('title', campaign->>'title', 'summary', campaign->>'summary', 'description', campaign->>'description')
          FROM jsonb_array_elements(public.get_public_promotion_campaigns(NULL)) AS campaign
      ) AS candidate
     WHERE (candidate.entity_type, candidate.entity_key) > (v_state.cursor_entity_type, v_state.cursor_entity_key)
     ORDER BY candidate.entity_type, candidate.entity_key
     LIMIT v_limit
  LOOP
    IF (SELECT count(*) FROM public.content_translation_jobs WHERE status IN ('queued', 'processing')) >= 5000 THEN
      v_queue_full := TRUE;
      EXIT;
    END IF;
    FOR v_field, v_source IN SELECT key, value #>> '{}' FROM jsonb_each(v_item.fields) AS entry(key, value) LOOP
      IF v_source IS NULL OR length(btrim(v_source)) = 0 OR length(v_source) > 5000 THEN CONTINUE; END IF;
      FOREACH v_locale IN ARRAY ARRAY['en', 'zh-CN', 'ms'] LOOP
        IF NOT app_private.queue_public_content_translation(
          v_item.entity_type, v_item.entity_key, v_field, v_locale,
          encode(extensions.digest(v_source, 'sha256'), 'hex'), 5000
        ) AND (SELECT count(*) FROM public.content_translation_jobs WHERE status IN ('queued', 'processing')) >= 5000 THEN
          v_queue_full := TRUE;
          EXIT;
        END IF;
      END LOOP;
      IF v_queue_full THEN EXIT; END IF;
    END LOOP;
    IF v_queue_full THEN EXIT; END IF;

    v_processed := v_processed + 1;
    UPDATE public.content_translation_backfill_state
       SET cursor_entity_type = v_item.entity_type, cursor_entity_key = v_item.entity_key, updated_at = now()
     WHERE singleton = TRUE;
  END LOOP;

  IF v_processed < v_limit AND NOT v_queue_full THEN
    UPDATE public.content_translation_backfill_state SET completed = TRUE, updated_at = now() WHERE singleton = TRUE;
  END IF;
  RETURN v_processed;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_public_content_translation_backfill_paused(p_paused BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM app_private.require_content_translation_service();
  UPDATE public.content_translation_backfill_state
     SET paused = coalesce(p_paused, TRUE), updated_at = now()
   WHERE singleton = TRUE;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_content_translation_jobs(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.content_translation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM app_private.require_content_translation_service();
  UPDATE public.content_translation_jobs
     SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
         last_error_code = 'attempts_exhausted', updated_at = now()
   WHERE status = 'processing' AND lease_expires_at <= now() AND attempts >= 5;
  RETURN QUERY
  WITH candidates AS (
    SELECT id
      FROM public.content_translation_jobs
     WHERE attempts < 5
       AND ((status = 'queued' AND available_at <= now())
         OR (status = 'processing' AND lease_expires_at <= now()))
     ORDER BY available_at, created_at
     LIMIT greatest(1, least(coalesce(p_limit, 10), 20))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.content_translation_jobs AS job
     SET status = 'processing', attempts = job.attempts + 1,
         lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
    FROM candidates
   WHERE job.id = candidates.id
  RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_content_translation_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_current_source_hash TEXT,
  p_translated_text TEXT,
  p_provider TEXT,
  p_model TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.content_translation_jobs%ROWTYPE;
BEGIN
  PERFORM app_private.require_content_translation_service();
  IF p_translated_text IS NULL OR length(btrim(p_translated_text)) NOT BETWEEN 1 AND 5000
     OR p_translated_text ~ '<[^>]+>' OR p_current_source_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_translation_output';
  END IF;

  SELECT * INTO v_job
    FROM public.content_translation_jobs
   WHERE id = p_job_id AND status = 'processing' AND lease_token = p_lease_token
   FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF v_job.source_hash <> p_current_source_hash THEN
    UPDATE public.content_translation_jobs
       SET status = 'superseded', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = p_job_id;
    RETURN FALSE;
  END IF;

  DELETE FROM public.public_content_translations
   WHERE entity_type = v_job.entity_type AND entity_key = v_job.entity_key
     AND field = v_job.field AND locale = v_job.locale AND source_hash <> v_job.source_hash;

  INSERT INTO public.public_content_translations(
    entity_type, entity_key, field, locale, source_hash, translated_text, provider, model
  ) VALUES (
    v_job.entity_type, v_job.entity_key, v_job.field, v_job.locale,
    v_job.source_hash, btrim(p_translated_text), p_provider, p_model
  )
  ON CONFLICT (entity_type, entity_key, field, locale, source_hash)
  DO UPDATE SET translated_text = EXCLUDED.translated_text,
                provider = EXCLUDED.provider, model = EXCLUDED.model, updated_at = now();

  UPDATE public.content_translation_jobs
     SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
         last_error_code = NULL, completed_at = now(), updated_at = now()
   WHERE id = p_job_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_content_translation_job(
  p_job_id UUID,
  p_lease_token UUID,
  p_error_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.content_translation_jobs%ROWTYPE;
BEGIN
  PERFORM app_private.require_content_translation_service();
  SELECT * INTO v_job
    FROM public.content_translation_jobs
   WHERE id = p_job_id AND status = 'processing' AND lease_token = p_lease_token
   FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.content_translation_jobs
     SET status = CASE WHEN v_job.attempts >= 5 THEN 'failed' ELSE 'queued' END,
         available_at = now() + make_interval(mins => least(60, power(2, greatest(0, v_job.attempts - 1))::INTEGER)),
         lease_token = NULL, lease_expires_at = NULL,
         last_error_code = CASE WHEN p_error_code ~ '^[a-z_]{1,50}$' THEN p_error_code ELSE 'provider_unavailable' END,
         updated_at = now()
   WHERE id = p_job_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.invalidate_public_content_translations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entity_type TEXT;
  v_entity_key TEXT;
  v_is_public BOOLEAN := FALSE;
  v_fields TEXT[] := ARRAY[]::TEXT[];
  v_field TEXT;
  v_locale TEXT;
  v_queue_on_change BOOLEAN := TRUE;
  v_content_changed BOOLEAN := FALSE;
  v_locales TEXT[] := ARRAY['en', 'zh-CN', 'ms'];
  v_source TEXT;
  v_old_row JSONB;
  v_new_row JSONB;
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    v_entity_type := 'product'; v_entity_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END;
    v_is_public := TG_OP <> 'DELETE' AND NEW.status = 'active' AND NEW.review_status = 'approved';
    v_fields := ARRAY['name', 'description'];
  ELSIF TG_TABLE_NAME = 'places' THEN
    v_entity_type := 'place'; v_entity_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END;
    v_is_public := TG_OP <> 'DELETE' AND NEW.status = 'active';
    v_fields := ARRAY['name', 'tagline', 'intro'];
  ELSIF TG_TABLE_NAME = 'place_informational_activities' THEN
    v_entity_type := 'place_informational_activity'; v_entity_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END;
    v_is_public := TG_OP <> 'DELETE' AND NEW.status = 'active';
    v_fields := ARRAY['title', 'description'];
  ELSIF TG_TABLE_NAME = 'reviews' THEN
    v_entity_type := 'review'; v_entity_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END;
    v_is_public := TG_OP <> 'DELETE' AND NEW.is_visible = TRUE;
    v_fields := ARRAY['title', 'body'];
    v_queue_on_change := FALSE;
  ELSIF TG_TABLE_NAME = 'promotion_campaigns' THEN
    v_entity_type := 'promotion_campaign'; v_entity_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::TEXT ELSE NEW.id::TEXT END;
    v_is_public := TG_OP <> 'DELETE' AND NEW.status = 'approved' AND NEW.ends_at > now();
    v_fields := ARRAY['title', 'summary', 'description'];
  ELSE
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' OR NOT v_is_public THEN
    DELETE FROM public.public_content_translations
     WHERE entity_type = v_entity_type AND entity_key = v_entity_key;
    UPDATE public.content_translation_jobs
       SET status = 'superseded', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE entity_type = v_entity_type AND entity_key = v_entity_key
       AND status IN ('queued', 'processing');
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  FOREACH v_field IN ARRAY v_fields LOOP
    v_source := to_jsonb(NEW)->>v_field;
    IF v_source IS NULL OR length(btrim(v_source)) = 0 THEN
      DELETE FROM public.public_content_translations
       WHERE entity_type = v_entity_type AND entity_key = v_entity_key AND field = v_field;
      UPDATE public.content_translation_jobs
         SET status = 'superseded', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE entity_type = v_entity_type AND entity_key = v_entity_key AND field = v_field
         AND status IN ('queued', 'processing');
      CONTINUE;
    END IF;

    IF TG_OP = 'INSERT' THEN
      v_content_changed := TRUE;
    ELSE
      v_old_row := to_jsonb(OLD);
      v_new_row := to_jsonb(NEW);
      v_content_changed := (v_old_row->>v_field) IS DISTINCT FROM v_source
        OR (TG_TABLE_NAME = 'products' AND ((v_old_row->>'status') IS DISTINCT FROM (v_new_row->>'status') OR (v_old_row->>'review_status') IS DISTINCT FROM (v_new_row->>'review_status')))
        OR (TG_TABLE_NAME = 'places' AND (v_old_row->>'status') IS DISTINCT FROM (v_new_row->>'status'))
        OR (TG_TABLE_NAME = 'place_informational_activities' AND (v_old_row->>'status') IS DISTINCT FROM (v_new_row->>'status'))
        OR (TG_TABLE_NAME = 'reviews' AND (v_old_row->>'is_visible') IS DISTINCT FROM (v_new_row->>'is_visible'))
        OR (TG_TABLE_NAME = 'promotion_campaigns' AND ((v_old_row->>'status') IS DISTINCT FROM (v_new_row->>'status') OR (v_old_row->>'ends_at') IS DISTINCT FROM (v_new_row->>'ends_at')));
    END IF;
    IF v_content_changed THEN
      DELETE FROM public.public_content_translations
       WHERE entity_type = v_entity_type AND entity_key = v_entity_key AND field = v_field;
      UPDATE public.content_translation_jobs
         SET status = 'superseded', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE entity_type = v_entity_type AND entity_key = v_entity_key AND field = v_field
         AND status IN ('queued', 'processing');
      IF v_queue_on_change THEN
        FOREACH v_locale IN ARRAY v_locales LOOP
          PERFORM app_private.queue_public_content_translation(
            v_entity_type, v_entity_key, v_field, v_locale, encode(extensions.digest(v_source, 'sha256'), 'hex'), 5000
          );
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_public_translation_sync
  AFTER INSERT OR UPDATE OF name, description, status, review_status OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION app_private.invalidate_public_content_translations();
CREATE TRIGGER places_public_translation_sync
  AFTER INSERT OR UPDATE OF name, tagline, intro, status OR DELETE ON public.places
  FOR EACH ROW EXECUTE FUNCTION app_private.invalidate_public_content_translations();
CREATE TRIGGER place_informational_activities_public_translation_sync
  AFTER INSERT OR UPDATE OF title, description, status OR DELETE ON public.place_informational_activities
  FOR EACH ROW EXECUTE FUNCTION app_private.invalidate_public_content_translations();
CREATE TRIGGER reviews_public_translation_sync
  AFTER INSERT OR UPDATE OF title, body, is_visible OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION app_private.invalidate_public_content_translations();
CREATE TRIGGER promotion_campaigns_public_translation_sync
  AFTER INSERT OR UPDATE OF title, summary, description, status, starts_at, ends_at OR DELETE ON public.promotion_campaigns
  FOR EACH ROW EXECUTE FUNCTION app_private.invalidate_public_content_translations();

REVOKE ALL ON FUNCTION app_private.require_content_translation_service(),
  app_private.queue_public_content_translation(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER),
  app_private.invalidate_public_content_translations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_content_translation_jobs(JSONB, INTEGER),
  public.backfill_public_content_translation_jobs(INTEGER),
  public.set_public_content_translation_backfill_paused(BOOLEAN),
  public.claim_content_translation_jobs(INTEGER),
  public.complete_content_translation_job(UUID, UUID, TEXT, TEXT, TEXT, TEXT),
  public.defer_content_translation_job(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_content_translation_jobs(JSONB, INTEGER),
  public.backfill_public_content_translation_jobs(INTEGER),
  public.set_public_content_translation_backfill_paused(BOOLEAN),
  public.claim_content_translation_jobs(INTEGER),
  public.complete_content_translation_job(UUID, UUID, TEXT, TEXT, TEXT, TEXT),
  public.defer_content_translation_job(UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
