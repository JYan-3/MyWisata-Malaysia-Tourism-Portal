-- The deployed legacy dispatcher already generates PDFs for Guest access-token
-- messages without a reason. Keep that supported path running during rollout;
-- registered receipt markers and reason-bearing Guest receipts still need v2.
DO $migration$
DECLARE definition text;
  previous text := '(p_include_receipts OR (payload->>''receiptOrderId'' IS NULL AND NOT (payload ? ''guestAccessToken'' AND coalesce(payload->>''reason'','''')='''')))';
  compatible text := '(p_include_receipts OR payload->>''receiptOrderId'' IS NULL OR (payload ? ''guestAccessToken'' AND coalesce(payload->>''reason'','''')=''''))';
BEGIN
  SELECT pg_get_functiondef('app_private.claim_receipt_aware_email_delivery(integer,boolean)'::regprocedure) INTO definition;
  IF position(previous IN definition)=0 THEN RAISE EXCEPTION 'receipt_claim_source_preflight_required'; END IF;
  EXECUTE replace(definition,previous,compatible);
END;
$migration$;
