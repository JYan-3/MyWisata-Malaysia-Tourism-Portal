/** Additional races on the existing disposable checkout fixture; no providers. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

export async function verifyCheckoutContention({ db, query, config }) {
  const sql = (text, args = []) => query(db, text, args);
  await sql(`ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS outlet_id uuid;
    ALTER TABLE public.products ALTER COLUMN outlet_id DROP NOT NULL;
    ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS outlet_id uuid;
    ALTER TABLE public.price_rules ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS bundle_product_ids uuid[];`);
  const vendor = '11111111-1111-4111-8111-111111111111';

  async function stock() {
    const product = crypto.randomUUID(), variant = crypto.randomUUID(), outlet = crypto.randomUUID();
    await sql(`INSERT INTO public.outlets(id,vendor_id,name,slug,status) VALUES($1,$2,'Synthetic race outlet',$3,'active')`, [outlet, vendor, outlet]);
    await sql(`INSERT INTO public.products(id,vendor_id,name,slug,base_price,requires_booking,status,review_status,product_type)
      VALUES($1,$2,'Synthetic last item',$3,10,false,'active','approved','retail')`, [product, vendor, product]);
    await sql(`INSERT INTO public.product_variants(id,product_id,name,price_offset,is_active) VALUES($1,$2,'Standard',2,true)`, [variant, product]);
    await sql(`INSERT INTO public.outlet_offers(product_id,outlet_id,price,status) VALUES($1,$2,20,'active')`, [product, outlet]);
    await sql(`INSERT INTO public.inventory(variant_id,outlet_id,quantity,reserved) VALUES($1,$2,1,0)`, [variant, outlet]);
    return { product, variant, outlet };
  }

  async function basket(item, user = null) {
    let guest = null;
    if (!user) guest = (await sql(`INSERT INTO public.guest_checkout_subjects(expires_at) VALUES(now()+interval '1 day') RETURNING id`)).rows[0].id;
    const cart = (await sql(`INSERT INTO public.carts(user_id,guest_subject_id) VALUES($1,$2) RETURNING id`, [user, guest])).rows[0].id;
    const line = (await sql(`INSERT INTO public.cart_items(cart_id,variant_id,outlet_id,quantity,unit_price)
      VALUES($1,$2,$3,1,22) RETURNING id`, [cart, item.variant, item.outlet])).rows[0].id;
    return { user, guest, cart, line, lines: [{ cart_item_id: line, product_id: item.product,
      variant_id: item.variant, slot_id: null, vendor_id: vendor, outlet_id: item.outlet,
      product_name: 'Synthetic last item', image_url: null, variant_name: 'Standard',
      slot_starts_at: null, unit_price: 22, quantity: 1, line_total: 22, requires_booking: false }] };
  }

  const prepare = (client, b, key, method = 'mock_card') => query(client, `SELECT public.checkout_transaction_core(
    $1,ARRAY[$2]::uuid[],$3,$4,$5,22,0,22,NULL,$6::jsonb,$7,$8,$9::jsonb) AS result`,
  [b.cart, b.line, key, `synthetic-${key}`, method, JSON.stringify(b.lines), b.user, b.guest,
    b.guest ? '{"email":"race@example.test"}' : null]);

  async function race(first, second, user = '') {
    const clients = [new pg.Client(config), new pg.Client(config)];
    try {
      await Promise.all(clients.map(client => client.connect()));
      for (const client of clients) {
        await query(client, 'BEGIN');
        await query(client, `SELECT set_config('request.jwt.claim.role','service_role',true),
          set_config('request.jwt.claim.sub',$1,true)`, [user]);
        await query(client, "SET LOCAL statement_timeout='5s'");
      }
      const a = await first(clients[0]);
      const pending = second(clients[1]).then(value => ({ value }), error => ({ error }));
      let observedWait = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const result = await sql(`SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'`, [clients[1].processID]);
        if (result.rowCount) { observedWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(observedWait, 'second transaction must actually wait on a database lock');
      await query(clients[0], 'COMMIT');
      const b = await pending;
      await query(clients[1], b.error ? 'ROLLBACK' : 'COMMIT');
      return { a: a.rows[0].result, b };
    } finally {
      await Promise.allSettled(clients.map(client => query(client, 'ROLLBACK')));
      await Promise.allSettled(clients.map(client => client.end()));
    }
  }

  const last = await stock();
  const [guestA, guestB] = await Promise.all([basket(last), basket(last)]);
  const contested = await race(client => prepare(client, guestA, 'last-a'), client => prepare(client, guestB, 'last-b'));
  assert.equal(contested.b.error?.message, 'inventory_unavailable');
  assert.deepEqual((await sql(`SELECT quantity,reserved FROM public.inventory WHERE variant_id=$1`, [last.variant])).rows[0], { quantity: 1, reserved: 1 });
  assert.equal(Number((await sql(`SELECT count(*) FROM public.checkout_sessions WHERE guest_subject_id=ANY($1::uuid[])`, [[guestA.guest, guestB.guest]])).rows[0].count), 1);
  assert.equal(Number((await sql(`SELECT count(*) FROM public.checkout_reservations WHERE variant_id=$1 AND status='held'`, [last.variant])).rows[0].count), 1);
  await sql(`SELECT public.finalize_checkout($1,'cancelled')`, [contested.a.checkout_session_id]);
  assert.equal((await sql(`SELECT reserved FROM public.inventory WHERE variant_id=$1`, [last.variant])).rows[0].reserved, 0);
  console.log('PASS checkout race: two independent Guests / last inventory unit; one winner, no oversell, cancellation releases hold');

  const retryStock = await stock();
  const retryBasket = await basket(retryStock);
  const retry = await race(client => prepare(client, retryBasket, 'retry-key'), client => prepare(client, retryBasket, 'retry-key'));
  assert.ifError(retry.b.error);
  assert.equal(retry.a.checkout_session_id, retry.b.value.rows[0].result.checkout_session_id);
  assert.equal(retry.a.order_id, retry.b.value.rows[0].result.order_id);
  assert.equal(Number((await sql(`SELECT count(*) FROM public.checkout_reservations WHERE variant_id=$1`, [retryStock.variant])).rows[0].count), 1);
  await sql(`SELECT public.finalize_checkout($1,'cancelled')`, [retry.a.checkout_session_id]);
  console.log('PASS checkout race: simultaneous same-key retries reuse one order/session/reservation');

  const user = crypto.randomUUID();
  await sql(`INSERT INTO public.users(id,email,status,email_verified_at,phone_verified_at)
    VALUES($1,$2,'active',now(),now())`, [user, `${user}@example.test`]);
  await sql(`INSERT INTO public.wallets(user_id,topup_sen,earnings_sen)
    VALUES($1,10000,0)`, [user]);
  const walletStock = await stock();
  const walletBasket = await basket(walletStock, user);
  await sql(`SELECT set_config('request.jwt.claim.sub',$1,false)`, [user]);
  const walletSession = (await prepare(db, walletBasket, 'wallet-race', 'wallet')).rows[0].result;
  const finalize = client => query(client, `SELECT public.finalize_customer_wallet_checkout($1,'succeeded') AS result`, [walletSession.checkout_session_id]);
  const paid = await race(finalize, finalize, user);
  assert.ifError(paid.b.error);
  assert.equal(paid.a.status, 'paid');
  assert.equal(paid.b.value.rows[0].result.status, 'paid');
  assert.deepEqual((await sql(`SELECT topup_sen::int topup,earnings_sen::int earnings FROM public.wallets WHERE user_id=$1`, [user])).rows[0], { topup: 7800, earnings: 0 });
  assert.deepEqual((await sql(`SELECT count(*)::int count,sum(amount_sen)::int amount FROM public.wallet_transactions
    WHERE user_id=$1 AND type='spend' AND order_id=$2`, [user, walletSession.order_id])).rows[0], { count: 1, amount: 2200 });
  assert.deepEqual((await sql(`SELECT quantity,reserved FROM public.inventory WHERE variant_id=$1`, [walletStock.variant])).rows[0], { quantity: 0, reserved: 0 });
  await sql(`SELECT set_config('request.jwt.claim.sub','',false)`);
  console.log('PASS checkout race: concurrent successful wallet finalizers debit 2200 sen and consume one stock unit exactly once');
}
