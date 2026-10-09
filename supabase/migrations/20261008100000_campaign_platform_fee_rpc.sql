-- The server role can only read promotion_campaigns (writes go through RPCs, see
-- 20261004102210_remove_unscoped_legacy_table_writes). The admin Platform fees
-- page therefore sets each event's per-item platform fee through this function.
-- It touches only the fee column, so it never bumps updated_at and cannot make
-- another admin's open campaign edit look stale.

CREATE OR REPLACE FUNCTION public.set_campaign_platform_fees(p_fees JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fee RECORD;
  v_count INT := 0;
BEGIN
  IF p_fees IS NULL OR jsonb_typeof(p_fees) <> 'array' THEN
    RAISE EXCEPTION 'campaign_fees_invalid';
  END IF;

  FOR v_fee IN SELECT * FROM jsonb_to_recordset(p_fees) AS x(id UUID, "perItemSen" BIGINT) LOOP
    IF v_fee.id IS NULL THEN RAISE EXCEPTION 'campaign_fees_invalid'; END IF;
    -- A negative or oversized value is rejected by the column CHECK (0..100000).
    UPDATE public.promotion_campaigns
       SET platform_fee_per_item_sen = v_fee."perItemSen"
     WHERE id = v_fee.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_campaign_platform_fees(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_campaign_platform_fees(JSONB) TO service_role;
