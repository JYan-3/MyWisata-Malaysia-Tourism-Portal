import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adminId = '00000000-0000-4000-8000-000000000091';

/** Run inside the disposable PostgreSQL cluster created by commerce-risk-db.test.mjs. */
export async function verifyFinancialReconciliation({ query }) {
  const sql = (text, values = []) => query(text, values);
  await sql(`
    ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS earnings_sen bigint NOT NULL DEFAULT 0;
    ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS reserved_earnings_sen bigint NOT NULL DEFAULT 0;
    ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS withdrawn_earnings_sen bigint NOT NULL DEFAULT 0;
    ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS wallet_id uuid;
    ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS bucket text;
    ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS direction text;
    ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS amount_sen bigint;
    ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS type text;
    ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS user_id uuid;
    CREATE TABLE IF NOT EXISTS public.wallet_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_id uuid NOT NULL,
      reference_id uuid, entry_type text NOT NULL, amount numeric NOT NULL,
      balance_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.withdrawal_requests ADD COLUMN IF NOT EXISTS wallet_id uuid;
    ALTER TABLE public.withdrawal_requests ADD COLUMN IF NOT EXISTS amount numeric;
    ALTER TABLE public.withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
    ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_requests_status_check
      CHECK (status IN ('pending','approved','rejected','hold','completed'));
    CREATE OR REPLACE FUNCTION app_private.check_data_integrity()
    RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    GRANT EXECUTE ON FUNCTION app_private.check_data_integrity() TO authenticated;
    CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT uid = '${adminId}'::uuid $$;
  `);

  const migration = await fs.readFile(
    path.join(repo, 'supabase/migrations/20261025090825_financial_ledger_reconciliation.sql'),
    'utf8',
  );
  await sql(migration);

  const wallets = [
    ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 5000, 0, 0],
    ['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 1000, 0, 0],
    ['00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000203', 3000, 1500, 800],
    ['00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000204', 0, 2000, 0],
  ];
  for (const [walletId, userId, available, reserved, withdrawn] of wallets) {
    await sql(`INSERT INTO public.users(id,email,full_name) VALUES($1,$2,'Synthetic reconciliation') ON CONFLICT(id) DO NOTHING`, [userId, `${userId}@example.test`]);
    await sql(`INSERT INTO public.wallets(id,user_id,earnings_sen,reserved_earnings_sen,withdrawn_earnings_sen)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET earnings_sen=$3,reserved_earnings_sen=$4,withdrawn_earnings_sen=$5`,
      [walletId, userId, available, reserved, withdrawn]);
  }

  await sql(`
    INSERT INTO public.wallet_ledger(wallet_id,reference_id,entry_type,amount,balance_type) VALUES
      ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301','credit',50,'earnings'),
      ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000303','credit',30,'earnings');
    INSERT INTO public.wallet_transactions(user_id,wallet_id,type,amount_sen,bucket,direction)
      VALUES ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','affiliate_commission',1000,'earnings','credit'),
        ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000103','affiliate_commission',3000,'earnings','credit');
    INSERT INTO public.withdrawal_requests(user_id,wallet_id,amount,status)
      VALUES ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000103',15,'pending'),
        ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000103',8,'completed'),
        ('00000000-0000-4000-8000-000000000204','00000000-0000-4000-8000-000000000104',12,'pending');
  `);

  await sql(`SELECT set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ role: 'authenticated', sub: adminId })]);
  await sql(`SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)`, [adminId]);
  await sql('SET ROLE authenticated');
  let result;
  try {
    result = (await sql('SELECT public.check_data_integrity() AS value')).rows[0].value.wallet_financial_reconciliation;
  } finally {
    await sql('RESET ROLE');
  }

  const byWallet = new Map(result.wallets.map((row) => [row.wallet_id, row]));
  const legacyOnly = byWallet.get(wallets[0][0]);
  assert.equal(legacyOnly.legacy_status, 'legacy_unreconciled');
  assert.equal(legacyOnly.available_ledger_comparison, 'unknown_legacy_unreconciled');
  assert.equal(Number(legacyOnly.ledger_available_earnings_sen), 0);

  const newOnly = byWallet.get(wallets[1][0]);
  assert.equal(newOnly.legacy_status, 'no_legacy_rows_detected_cutover_unverified');
  assert.equal(newOnly.available_ledger_comparison, 'unknown_cutover_unverified');
  assert.equal(Number(newOnly.ledger_available_earnings_sen), 1000);

  const mixed = byWallet.get(wallets[2][0]);
  assert.equal(mixed.legacy_status, 'legacy_unreconciled');
  assert.equal(Number(mixed.ledger_available_earnings_sen), 3000);
  assert.equal(mixed.reserved_matches_requests, true);
  assert.equal(mixed.withdrawn_matches_completed, true);

  const reservedMismatch = byWallet.get(wallets[3][0]);
  assert.equal(reservedMismatch.reserved_matches_requests, false);
  assert.equal(Number((await sql('SELECT earnings_sen FROM public.wallets WHERE id=$1', [wallets[3][0]])).rows[0].earnings_sen), 0,
    'reconciliation reports discrepancies and never repairs balances');

  await sql('SET ROLE anon');
  try {
    await assert.rejects(() => sql('SELECT public.check_data_integrity()'), { code: '42501' });
  } finally {
    await sql('RESET ROLE');
  }
  console.log('PASS finance: legacy/new buckets remain distinct; reserved/withdrawn discrepancies are visible and never auto-repaired');
}
