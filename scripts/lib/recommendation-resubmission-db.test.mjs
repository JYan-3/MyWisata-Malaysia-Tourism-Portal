import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { asRole, withOwnedFlowDb } from './owned-flow-db.mjs';

const migrationPath = 'supabase/migrations/20261024210241_recommendation_owner_resubmission.sql';

const message = (error) => String(error?.message ?? error);

const expectDbError = async (promise, pattern, label) => {
  await assert.rejects(promise, (error) => {
    assert.match(message(error), pattern, label);
    return true;
  });
};

const validData = (name = 'Updated Synthetic Vendor') => ({
  imageAttested: true,
  vendorName: name,
  description: 'A sufficiently long description for the recommendation test.',
  whyRecommend: 'A sufficiently long reason for recommending this test vendor.',
  categoryId: null,
  location: {
    name: 'Synthetic Place',
    formattedAddress: '123 Test Street, Kuala Lumpur',
    placeId: 'place-test',
    latitude: 3.139,
    longitude: 101.6869,
  },
  contact: {
    phone: '+60123456789',
    email: 'synthetic@example.test',
    website: '',
  },
});

await withOwnedFlowDb(async ({ db, connect }) => {
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await db.query(`
    CREATE TABLE public.users (
      id uuid PRIMARY KEY,
      email text,
      full_name text,
      preferred_locale text
    );
    CREATE TABLE public.roles (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE public.user_roles (user_id uuid NOT NULL, role_id uuid NOT NULL);
    CREATE TABLE public.categories (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE public.vendor_recommendations (
      id uuid PRIMARY KEY,
      recommender_id uuid NOT NULL,
      vendor_name text NOT NULL,
      vendor_name_normalized text NOT NULL,
      vendor_address text,
      description text,
      why_recommend text,
      category_id uuid,
      status text NOT NULL,
      reviewer_id uuid,
      reviewed_at timestamptz,
      rejection_reason text,
      converted_vendor_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      assigned_to uuid,
      claimed_at timestamptz,
      changes_requested_at timestamptz,
      changes_requested_reason text,
      suggested_place_id uuid,
      resolved_place_id uuid,
      place_resolution_status text,
      google_place_id text,
      location_name text,
      formatted_address text,
      latitude double precision,
      longitude double precision,
      contact_phone text,
      contact_email text,
      contact_website text,
      image_attested_at timestamptz
    );
    CREATE TABLE public.recommendation_images (
      id uuid PRIMARY KEY,
      recommendation_id uuid,
      owner_id uuid NOT NULL,
      storage_path text NOT NULL,
      is_staged boolean NOT NULL,
      sort_order smallint NOT NULL DEFAULT 0,
      removed_at timestamptz,
      removed_by uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      upload_completed boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.recommendation_review_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recommendation_id uuid NOT NULL,
      recommender_id uuid NOT NULL,
      from_status text NOT NULL,
      to_status text NOT NULL,
      action text NOT NULL CONSTRAINT recommendation_review_events_action_check
        CHECK (action IN ('approve', 'reject', 'request_changes')),
      actor_id uuid,
      actor_role text NOT NULL,
      internal_note text,
      customer_message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      type text,
      title text,
      body text,
      link text,
      event_key text,
      metadata jsonb
    );
    CREATE UNIQUE INDEX notifications_event_key ON public.notifications(event_key)
      WHERE event_key IS NOT NULL;
    CREATE TABLE public.audit_logs (
      actor_id uuid,
      action text,
      entity_type text,
      entity_id uuid,
      before_data jsonb,
      after_data jsonb,
      note text
    );
    CREATE FUNCTION public.customer_can_submit_recommendation(p_user uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT p_user IS NOT NULL $$;
    CREATE FUNCTION public.can_review_recommendation(p_user uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user AND r.name IN ('admin', 'super_admin', 'recommendation_reviewer')
      ) $$;
    CREATE FUNCTION public.is_super_admin(p_user uuid)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = p_user AND r.name = 'super_admin'
      ) $$;
  `);

  const reviewFunction = `
    CREATE FUNCTION app_private.admin_review_recommendation(
      p_rec_id uuid,
      p_action text,
      p_internal_note text DEFAULT NULL,
      p_customer_message text DEFAULT NULL
    ) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    DECLARE
      v_recommendation public.vendor_recommendations%ROWTYPE;
      v_status text;
      v_actor_role text;
      v_message text;
    BEGIN
      IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
      IF NOT public.can_review_recommendation(auth.uid()) THEN RAISE EXCEPTION 'admin_required'; END IF;
      IF p_action NOT IN ('approve', 'reject', 'request_changes') THEN RAISE EXCEPTION 'invalid_action'; END IF;
      IF char_length(COALESCE(p_internal_note, '')) > 1000 THEN RAISE EXCEPTION 'internal_note_too_long'; END IF;
      IF char_length(COALESCE(p_customer_message, '')) > 500 THEN RAISE EXCEPTION 'customer_message_too_long'; END IF;
      IF p_action <> 'approve' AND char_length(BTRIM(COALESCE(p_customer_message, ''))) < 10 THEN
        RAISE EXCEPTION 'customer_message_required';
      END IF;
      SELECT * INTO v_recommendation FROM public.vendor_recommendations
       WHERE id = p_rec_id AND status = 'pending' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_found_or_already_reviewed'; END IF;
      IF v_recommendation.recommender_id = auth.uid() THEN RAISE EXCEPTION 'self_dealing'; END IF;
      IF NOT public.is_super_admin(auth.uid())
         AND v_recommendation.assigned_to IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'recommendation_not_assigned';
      END IF;
      SELECT role.name INTO v_actor_role FROM public.user_roles assignment
        JOIN public.roles role ON role.id = assignment.role_id
       WHERE assignment.user_id = auth.uid() AND role.name IN ('admin', 'super_admin')
       ORDER BY CASE role.name WHEN 'super_admin' THEN 0 ELSE 1 END LIMIT 1;
      IF v_actor_role IS NULL THEN RAISE EXCEPTION 'admin_required'; END IF;
      v_status := CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END;
      v_message := CASE WHEN p_action = 'approve' AND NULLIF(BTRIM(COALESCE(p_customer_message, '')), '') IS NULL
        THEN 'Great find! Your recommendation was approved.' ELSE BTRIM(p_customer_message) END;
      UPDATE public.vendor_recommendations SET status = v_status, reviewer_id = auth.uid(), reviewed_at = now(),
        rejection_reason = CASE WHEN p_action = 'reject' THEN v_message ELSE NULL END,
        changes_requested_at = CASE WHEN p_action = 'request_changes' THEN now() ELSE NULL END,
        changes_requested_reason = CASE WHEN p_action = 'request_changes' THEN v_message ELSE NULL END
       WHERE id = p_rec_id;
      INSERT INTO public.recommendation_review_events(
        recommendation_id,recommender_id,from_status,to_status,action,actor_id,actor_role,internal_note,customer_message
      ) VALUES (p_rec_id,v_recommendation.recommender_id,v_recommendation.status,v_status,p_action,auth.uid(),v_actor_role,
        NULLIF(BTRIM(p_internal_note),''),v_message);
      INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
        VALUES(auth.uid(),'recommendation.'||p_action,'vendor_recommendation',p_rec_id,
          jsonb_build_object('status',v_recommendation.status),jsonb_build_object('status',v_status),NULLIF(BTRIM(p_internal_note),''));
      INSERT INTO public.notifications(user_id,type,title,body,link,event_key,metadata)
        VALUES(v_recommendation.recommender_id,
          CASE p_action WHEN 'approve' THEN 'recommendation_approved' WHEN 'reject' THEN 'recommendation_rejected'
            ELSE 'recommendation_changes_requested' END,
          CASE p_action WHEN 'approve' THEN 'Recommendation approved' WHEN 'reject' THEN 'Recommendation reviewed'
            ELSE 'Changes requested for your recommendation' END,
          v_message,'/customer/recommendations',
          'recommendation_decision:' || p_rec_id::text || ':' || v_status,
          jsonb_build_object('recommendation_id',p_rec_id,'vendor_name',v_recommendation.vendor_name))
        ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING;
      RETURN jsonb_build_object('recommendationId',p_rec_id,'status',v_status,'recommenderId',v_recommendation.recommender_id,
        'vendorName',v_recommendation.vendor_name);
    END; $$;
  `;
  await db.query(reviewFunction);

  await db.query(`
    GRANT USAGE ON SCHEMA public, app_private TO authenticated, anon, service_role;
    GRANT SELECT, INSERT, UPDATE ON public.vendor_recommendations TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON public.recommendation_images TO authenticated;
    GRANT SELECT, INSERT ON public.recommendation_review_events, public.notifications, public.audit_logs TO authenticated;
    GRANT SELECT ON public.categories, public.users, public.roles, public.user_roles TO authenticated;
    GRANT EXECUTE ON FUNCTION app_private.admin_review_recommendation(uuid,text,text,text) TO authenticated;
  `);

  await db.query(await readFile(migrationPath, 'utf8'));
  await db.query(await readFile('supabase/migrations/20261024211734_recommendation_name_normalization_contract.sql','utf8'));
  assert.equal((await db.query("SELECT public.normalize_vendor_name(U&'  Ａ\\200B   Cafe  ') n")).rows[0].n,'a cafe');

  const owner = randomUUID();
  const otherOwner = randomUUID();
  const reviewer = randomUUID();
  const customReviewer = randomUUID();
  const adminRole = randomUUID();
  const customReviewRole = randomUUID();
  const category = randomUUID();
  const retained = randomUUID();
  const staged = randomUUID();
  await db.query('INSERT INTO public.users(id,email,full_name,preferred_locale) VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12),($13,$14,$15,$16)', [
    owner, 'owner@example.test', 'Owner', 'en', otherOwner, 'other@example.test', 'Other', 'en', reviewer, 'reviewer@example.test', 'Reviewer', 'en', customReviewer, 'custom-reviewer@example.test', 'Custom reviewer', 'en',
  ]);
  await db.query('INSERT INTO public.roles(id,name) VALUES ($1,\'admin\'),($2,\'recommendation_reviewer\')', [adminRole, customReviewRole]);
  await db.query('INSERT INTO public.user_roles(user_id,role_id) VALUES ($1,$2)', [reviewer, adminRole]);
  await db.query('INSERT INTO public.user_roles(user_id,role_id) VALUES ($1,$2)', [customReviewer, customReviewRole]);
  await db.query('INSERT INTO public.categories(id,is_active) VALUES ($1,true)', [category]);
  const insertRecommendation = async (status = 'changes_requested') => {
    const id = randomUUID();
    await db.query(`INSERT INTO public.vendor_recommendations(
      id,recommender_id,vendor_name,vendor_name_normalized,description,why_recommend,category_id,status,
      created_at,changes_requested_at,changes_requested_reason,place_resolution_status,location_name,formatted_address,
      latitude,longitude,contact_phone,image_attested_at
    ) VALUES ($1,$2,'Original Synthetic Vendor','original synthetic vendor','Original description with enough length.',
      'Original reason with enough length.', $3,$4,now(),now(),'Please update this recommendation.','unresolved',
      'Original Place','123 Test Street, Kuala Lumpur',3.139,101.6869,'+60123456789',now())`, [id, owner, category, status]);
    return id;
  };

  const rec = await insertRecommendation();
  await db.query('INSERT INTO public.recommendation_images(id,recommendation_id,owner_id,storage_path,is_staged,sort_order) VALUES ($1,$2,$3,$4,false,0)', [retained, rec, owner, `${owner}/retained.jpg`]);
  await db.query('INSERT INTO public.recommendation_images(id,recommendation_id,owner_id,storage_path,is_staged,sort_order) VALUES ($1,NULL,$2,$3,true,0)', [staged, owner, `${owner}/staged.jpg`]);
  // Keep PostgreSQL's microsecond precision; JavaScript Date would truncate it
  // and turn a valid optimistic-lock token into a false conflict.
  const before = (await db.query('SELECT updated_at::text AS updated_at FROM public.vendor_recommendations WHERE id=$1', [rec])).rows[0].updated_at;
  const ownerClient = await connect();
  await asRole(ownerClient, 'authenticated', owner);
  const data = validData(); data.categoryId = category;
  const result = (await ownerClient.query(
    'SELECT public.resubmit_recommendation($1,$2,$3,$4,$5) AS result', [rec, before, data, [retained], [staged]],
  )).rows[0].result;
  assert.equal(result.id, rec);
  assert.equal(result.status, 'pending');
  assert.notEqual(result.version, before);
  const snapshot = (await db.query('SELECT status,vendor_name,assigned_to,reviewer_id,changes_requested_reason,place_resolution_status FROM public.vendor_recommendations WHERE id=$1', [rec])).rows[0];
  assert.equal(snapshot.status, 'pending');
  assert.equal(snapshot.vendor_name, 'Updated Synthetic Vendor');
  assert.equal(snapshot.assigned_to, null);
  assert.equal(snapshot.reviewer_id, null);
  assert.equal(snapshot.changes_requested_reason, null);
  assert.equal(snapshot.place_resolution_status, 'unresolved');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.recommendation_review_events WHERE recommendation_id=$1 AND action='resubmit'", [rec])).rows[0].n, 1);
  const imageRows = (await db.query('SELECT id,recommendation_id,is_staged,removed_at,sort_order FROM public.recommendation_images WHERE owner_id=$1 ORDER BY id', [owner])).rows;
  assert.deepEqual(imageRows.map((row) => [row.id, row.recommendation_id, row.is_staged, row.removed_at !== null, row.sort_order]), [
    [retained, rec, false, false, 0], [staged, rec, false, false, 1],
  ].sort((a, b) => a[0].localeCompare(b[0])));

  await expectDbError(ownerClient.query('SELECT public.resubmit_recommendation($1,$2,$3,$4,$5)', [rec, before, data, [retained], []]), /recommendation_changed|recommendation_not_editable/, 'stale owner version rejected');

  const otherClient = await connect();
  await asRole(otherClient, 'authenticated', otherOwner);
  await expectDbError(otherClient.query('SELECT public.resubmit_recommendation($1,$2,$3,$4,$5)', [rec, result.version, data, [retained], []]), /recommendation_not_found/, 'non-owner cannot resubmit');

  const wrongImageRec = await insertRecommendation();
  const wrongOwnerImage = randomUUID();
  await db.query('INSERT INTO public.recommendation_images(id,recommendation_id,owner_id,storage_path,is_staged,sort_order) VALUES ($1,$2,$3,$4,false,0)', [wrongOwnerImage, wrongImageRec, otherOwner, `${otherOwner}/wrong.jpg`]);
  const wrongImageVersion = (await db.query('SELECT updated_at::text AS updated_at FROM public.vendor_recommendations WHERE id=$1', [wrongImageRec])).rows[0].updated_at;
  const wrongImageData = validData('Wrong Image Vendor'); wrongImageData.categoryId = category;
  await expectDbError(ownerClient.query('SELECT public.resubmit_recommendation($1,$2,$3,$4,$5)', [wrongImageRec, wrongImageVersion, wrongImageData, [wrongOwnerImage], []]), /staged_images_invalid/, 'owner cannot retain another users image');

  const reviewerClient = await connect();
  await asRole(reviewerClient, 'authenticated', reviewer);
  await expectDbError(reviewerClient.query('SELECT public.admin_review_recommendation($1,\'approve\',NULL,NULL)', [rec]), /expected_version_required/, 'legacy reviewer RPC requires version');
  await expectDbError(reviewerClient.query('SELECT app_private.admin_review_recommendation($1,\'approve\',NULL,NULL)', [rec]), /permission denied/, 'legacy private reviewer RPC is revoked');
  await expectDbError(ownerClient.query('UPDATE public.vendor_recommendations SET vendor_name=\'bypass\' WHERE id=$1', [rec]), /permission denied/, 'direct customer UPDATE is revoked');

  const reviewRec = await insertRecommendation('pending');
  await db.query('UPDATE public.vendor_recommendations SET assigned_to=$1 WHERE id=$2', [reviewer, reviewRec]);
  const reviewVersion = (await db.query('SELECT updated_at::text AS updated_at FROM public.vendor_recommendations WHERE id=$1', [reviewRec])).rows[0].updated_at;
  await expectDbError(
    reviewerClient.query('SELECT public.admin_review_recommendation_versioned($1,$2,\'approve\',NULL,NULL)', [reviewRec, '2000-01-01 00:00:00+00']),
    /recommendation_changed/,
    'stale reviewer version is rejected',
  );
  const reviewResult = (await reviewerClient.query(
    'SELECT public.admin_review_recommendation_versioned($1,$2,\'approve\',NULL,NULL) AS result', [reviewRec, reviewVersion],
  )).rows[0].result;
  assert.equal(reviewResult.status, 'approved');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.recommendation_review_events WHERE recommendation_id=$1 AND action='approve'", [reviewRec])).rows[0].n, 1);

  const customReviewRec = await insertRecommendation('pending');
  await db.query('UPDATE public.vendor_recommendations SET assigned_to=$1 WHERE id=$2', [customReviewer, customReviewRec]);
  const customReviewVersion = (await db.query('SELECT updated_at::text AS updated_at FROM public.vendor_recommendations WHERE id=$1', [customReviewRec])).rows[0].updated_at;
  const customReviewerClient = await connect();
  await asRole(customReviewerClient, 'authenticated', customReviewer);
  const customReviewResult = (await customReviewerClient.query(
    'SELECT public.admin_review_recommendation_versioned($1,$2,\'approve\',NULL,NULL) AS result', [customReviewRec, customReviewVersion],
  )).rows[0].result;
  assert.equal(customReviewResult.status, 'approved');
  assert.equal((await db.query("SELECT actor_role FROM public.recommendation_review_events WHERE recommendation_id=$1 AND action='approve'", [customReviewRec])).rows[0].actor_role, 'staff');

  const concurrentRec = await insertRecommendation();
  const concurrentRetained = randomUUID();
  await db.query('INSERT INTO public.recommendation_images(id,recommendation_id,owner_id,storage_path,is_staged,sort_order) VALUES ($1,$2,$3,$4,false,0)', [concurrentRetained, concurrentRec, owner, `${owner}/concurrent.jpg`]);
  const concurrentVersion = (await db.query('SELECT updated_at::text AS updated_at FROM public.vendor_recommendations WHERE id=$1', [concurrentRec])).rows[0].updated_at;
  const clientA = await connect();
  const clientB = await connect();
  await asRole(clientA, 'authenticated', owner);
  await asRole(clientB, 'authenticated', owner);
  const concurrentData = validData('Concurrent Vendor'); concurrentData.categoryId = category;
  const [attemptA, attemptB] = await Promise.allSettled([
    clientA.query('SELECT public.resubmit_recommendation($1,$2,$3,$4,$5) AS result', [concurrentRec, concurrentVersion, concurrentData, [concurrentRetained], []]),
    clientB.query('SELECT public.resubmit_recommendation($1,$2,$3,$4,$5) AS result', [concurrentRec, concurrentVersion, concurrentData, [concurrentRetained], []]),
  ]);
  const fulfilled = [attemptA, attemptB].filter((attempt) => attempt.status === 'fulfilled');
  const rejected = [attemptA, attemptB].filter((attempt) => attempt.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent resubmission succeeds');
  assert.equal(rejected.length, 1, 'the stale concurrent resubmission fails');
  assert.match(message(rejected[0].reason), /recommendation_changed|recommendation_not_editable/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.recommendation_review_events WHERE recommendation_id=$1 AND action='resubmit'", [concurrentRec])).rows[0].n, 1);

  const acl = (await db.query(`
    SELECT has_function_privilege('anon','public.resubmit_recommendation(uuid,timestamptz,jsonb,uuid[],uuid[])','EXECUTE') AS anon_resubmit,
           has_function_privilege('authenticated','public.resubmit_recommendation(uuid,timestamptz,jsonb,uuid[],uuid[])','EXECUTE') AS auth_resubmit,
           has_function_privilege('authenticated','public.admin_review_recommendation_versioned(uuid,timestamptz,text,text,text)','EXECUTE') AS auth_review,
           has_table_privilege('authenticated','public.vendor_recommendations','UPDATE') AS auth_update
  `)).rows[0];
  assert.equal(acl.anon_resubmit, false);
  assert.equal(acl.auth_resubmit, true);
  assert.equal(acl.auth_review, true);
  assert.equal(acl.auth_update, false);

  await Promise.allSettled([ownerClient.end(), otherClient.end(), reviewerClient.end(), customReviewerClient.end(), clientA.end(), clientB.end()]);
  console.log('PASS recommendation same-ID resubmission, immutable history, owner/image/version checks, concurrent fencing, legacy RPC and direct UPDATE ACL');
});
