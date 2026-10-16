BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE result jsonb; rid uuid; err text; BEGIN
 UPDATE public.users SET kyc_status='approved',status='active',phone='+60123456789',phone_verified_at=now() WHERE id='00000000-0000-0000-0000-000000000004';
 INSERT INTO public.wallets(user_id,earnings_sen,reserved_balance_sen) VALUES('00000000-0000-0000-0000-000000000004',0,5000)
 ON CONFLICT(user_id) DO UPDATE SET earnings_sen=0,reserved_balance_sen=5000;
 result:=public.start_withdrawal_payout_attempt('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
 IF result->>'requires_review'<>'true' OR (SELECT status FROM public.withdrawal_requests WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')<>'hold' THEN RAISE EXCEPTION 'legacy identity was guessed'; END IF;
 -- Match real submission: provider/reference are omitted and stamped by the
 -- later destination trigger. The phone generation must still be captured.
 INSERT INTO public.withdrawal_requests(user_id,amount,status,destination_id)
 VALUES('00000000-0000-0000-0000-000000000004',50,'approved','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') RETURNING id INTO rid;
 UPDATE public.users SET phone_verified_at=now()+interval '1 second' WHERE id='00000000-0000-0000-0000-000000000004';
 result:=public.start_withdrawal_payout_attempt(rid);
 IF result->>'reason_code'<>'withdrawal_identity_changed' OR EXISTS(SELECT 1 FROM public.withdrawal_requests WHERE id=rid AND payout_execution_claim_token IS NOT NULL) THEN RAISE EXCEPTION 'changed identity acquired payout'; END IF;
 IF (SELECT reserved_balance_sen FROM public.wallets WHERE user_id='00000000-0000-0000-0000-000000000004')<>5000 THEN RAISE EXCEPTION 'review hold released funds'; END IF;
 BEGIN UPDATE public.withdrawal_requests SET payout_phone_verified_at=now()+interval '2 seconds' WHERE id=rid; EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'withdrawal_identity_immutable' THEN RAISE EXCEPTION 'snapshot mutable'; END IF;
 INSERT INTO public.withdrawal_requests(user_id,amount,status,destination_id)
 VALUES('00000000-0000-0000-0000-000000000004',50,'approved','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') RETURNING id INTO rid;
 UPDATE public.users SET status='suspended' WHERE id='00000000-0000-0000-0000-000000000004';
 result:=public.start_withdrawal_payout_attempt(rid);
 IF result->>'reason_code'<>'withdrawal_eligibility_lost' THEN RAISE EXCEPTION 'suspended account acquired payout'; END IF;
 UPDATE public.users SET status='active' WHERE id='00000000-0000-0000-0000-000000000004';
 INSERT INTO public.withdrawal_requests(user_id,amount,status,destination_id)
 VALUES('00000000-0000-0000-0000-000000000004',50,'approved','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') RETURNING id INTO rid;
 result:=public.start_withdrawal_payout_attempt(rid);
 IF result->>'acquired'<>'true' THEN RAISE EXCEPTION 'eligible request cannot acquire claim'; END IF;
 err:=NULL;
 BEGIN
  UPDATE public.wallets SET reserved_balance_sen=0 WHERE user_id='00000000-0000-0000-0000-000000000004';
  UPDATE public.withdrawal_requests SET status='rejected' WHERE id=rid;
 EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'payout_execution_in_progress' OR (SELECT reserved_balance_sen FROM public.wallets WHERE user_id='00000000-0000-0000-0000-000000000004')<>5000 THEN RAISE EXCEPTION 'claimed payout rejection released reserve'; END IF;
 err:=NULL;
 BEGIN UPDATE public.withdrawal_requests SET status='hold' WHERE id=rid; EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'payout_execution_in_progress' THEN RAISE EXCEPTION 'claimed payout can be held'; END IF;
 result:=public.start_withdrawal_payout_attempt(rid);
 IF result->>'acquired'<>'false' THEN RAISE EXCEPTION 'claim acquired twice'; END IF;
 IF has_function_privilege('authenticated','public.start_withdrawal_payout_attempt(uuid)','EXECUTE') OR has_function_privilege('service_role','app_private.withdrawal_execution_failure(uuid)','EXECUTE') THEN RAISE EXCEPTION 'payout boundary exposed'; END IF;
END; $$;
ROLLBACK;
