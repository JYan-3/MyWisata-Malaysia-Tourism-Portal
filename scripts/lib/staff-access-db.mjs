/** Actual governed SQL in the existing disposable loopback PostgreSQL harness. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export async function verifyStaffAccess({ db, query }) {
  assert.ok(['127.0.0.1', '::1', 'localhost'].includes(db.connectionParameters.host));
  const sql = (text, values = []) => query(db, text, values);
  const file = (name) => fs.readFile(`supabase/migrations/${name}`, 'utf8');
  function extract(source, name) {
    const result = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?^\\$\\$;`, 'm'))?.[0];
    assert.ok(result, `actual ${name} source must exist`);
    return result;
  }
  await sql(`
    CREATE TABLE public.staff_role_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),role_id uuid,user_id uuid,assigned_by uuid,revoked_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE public.staff_module_legacy_roles(module_id uuid,role_name text,grants_permissions boolean,PRIMARY KEY(module_id,role_name));
    CREATE TABLE public.staff_module_groups(id uuid PRIMARY KEY,key text,is_active boolean);
    CREATE TABLE public.staff_module_group_members(group_id uuid,module_id uuid);
    ALTER TABLE public.withdrawal_requests ADD COLUMN IF NOT EXISTS approval_cycle integer DEFAULT 1,
      ADD COLUMN IF NOT EXISTS customer_reason text, ADD COLUMN IF NOT EXISTS customer_reason_category text,
      ADD COLUMN IF NOT EXISTS customer_visible_at timestamptz;
    ALTER TABLE public.withdrawal_approvals ADD COLUMN IF NOT EXISTS approval_cycle integer DEFAULT 1,
      ADD COLUMN IF NOT EXISTS reason_category text;
    ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS reserved_earnings_sen bigint DEFAULT 0;
    ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS withdrawal_id uuid;
    ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key text, ADD COLUMN IF NOT EXISTS category text,
      ADD COLUMN IF NOT EXISTS metadata jsonb;
    CREATE FUNCTION app_private.staff_authority_assurance() RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT auth.role()<>'authenticated' OR current_setting('request.test.staff_verified',true)='true'; $$;
  `);
  const original = await file('20260905073000_staff_role_permissions.sql');
  await sql(extract(original, 'require_active_global_staff_super_admin'));
  await sql(extract(original, 'validate_staff_reason'));
  await sql(extract(await file('20260906011500_staff_role_assignment_ux.sql'), 'revoke_staff_role_assignment'));
  await sql(extract(await file('20260915222000_dynamic_staff_modules.sql'), 'validate_staff_module_keys'));
  await sql(await file('20261015001000_staff_roles_require_aal2.sql'));
  await sql(`CREATE OR REPLACE FUNCTION public.has_staff_permission(p_user_id uuid,p_permission_key text) RETURNS boolean LANGUAGE sql AS $$ SELECT app_private.has_staff_permission(p_user_id,p_permission_key); $$;
    CREATE OR REPLACE FUNCTION public.is_approver(uid uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT app_private.is_approver(uid); $$;`);
  // The existing governance assurance patch is separate from the later helper repair.
  const passkey = await file('20261014194717_staff_passkey_boundaries.sql');
  const governancePatch = passkey.slice(passkey.indexOf('DO $$ DECLARE f record;'), passkey.indexOf('-- Payout retry'));
  await sql(governancePatch);
  await sql(extract(await file('20260912173000_withdrawal_trust_boundary.sql'), 'reject_wallet_withdrawal_server'));
  await sql(extract(await file('20260824221600_domain_role_matrix.sql'), 'admin_link_vendor_recommendation'));
  await sql('ALTER FUNCTION public.admin_link_vendor_recommendation(uuid,uuid) SET SCHEMA app_private');
  await sql(`INSERT INTO public.staff_modules(key,label,section_key,section_label,href) VALUES
    ('recommendations','Recommendations','governance','Governance','/admin/recommendations'),
    ('withdrawals','Withdrawals','finance','Finance','/admin/withdrawals'),
    ('unsupported_staff_test','Unsupported','test','Test','/admin/unsupported-test') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.staff_permissions(key,module,action,description) VALUES('admin.withdrawal.approve','withdrawal','approve','Approve withdrawals') ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.staff_module_permissions SELECT m.id,p.id FROM public.staff_modules m CROSS JOIN public.staff_permissions p WHERE m.key='withdrawals' AND p.key='admin.withdrawal.approve' ON CONFLICT DO NOTHING;
    INSERT INTO public.staff_module_legacy_roles SELECT id,'admin',false FROM public.staff_modules WHERE key='recommendations';
    INSERT INTO public.staff_module_legacy_roles SELECT id,'approver',true FROM public.staff_modules WHERE key='withdrawals';
    GRANT INSERT,UPDATE,DELETE ON public.user_roles TO authenticated;
  `);
  await sql(await file('20261023011427_complete_staff_access_governance.sql'));
  const [boss, chen, li, roleA, roleB, reviewRole, a1, a2, b1, reviewAssignment] = Array.from({ length: 10 }, () => crypto.randomUUID());
  for (const [id, name] of [[boss, 'Governance boss'], [chen, 'Chen staff fixture'], [li, 'Li staff fixture']]) {
    await sql('INSERT INTO public.users(id,email,full_name,status) VALUES($1,$2,$3,\'active\')', [id, `${id}@example.test`, name]);
  }
  await sql("INSERT INTO public.roles(name) VALUES('staff'),('super_admin'),('approver') ON CONFLICT(name) DO NOTHING");
  await sql("INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name='super_admin'", [boss]);
  await sql("INSERT INTO public.user_roles(user_id,role_id) SELECT x.id,r.id FROM (VALUES($1::uuid),($2::uuid)) x(id) CROSS JOIN public.roles r WHERE r.name='staff'", [chen, li]);
  for (const [id, name, module] of [[roleA, 'Wallet team A', 'withdrawals'], [roleB, 'Wallet team B', 'withdrawals'], [reviewRole, 'Rec reviewers', 'recommendations']]) {
    await sql('INSERT INTO public.staff_roles(id,name) VALUES($1,$2)', [id, name]);
    await sql('INSERT INTO public.staff_role_modules SELECT $1,id FROM public.staff_modules WHERE key=$2', [id, module]);
  }
  for (const [id, role, user] of [[a1, roleA, chen], [a2, roleB, chen], [b1, roleA, li], [reviewAssignment, reviewRole, chen]]) {
    await sql('INSERT INTO public.staff_role_assignments(id,role_id,user_id,assigned_by) VALUES($1,$2,$3,$4)', [id, role, user, boss]);
  }
  const as = async (name, id = boss) => {
    await sql("SELECT set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false),set_config('request.jwt.claims',$3,false),set_config('request.test.staff_verified','true',false)", [name, id, JSON.stringify({ aal: 'aal2' })]);
  };
  const access = async (excluded = null) => (await sql('SELECT public.get_staff_employee_access($1,$2) AS value', [chen, excluded])).rows[0].value;
  const allowed = async (permission) => (await sql('SELECT public.has_staff_permission($1,$2) AS value', [chen, permission])).rows[0].value;
  await as('authenticated');
  assert.equal((await access()).sources.filter((s) => s.permissionKey === 'admin.withdrawal.approve').length, 2);
  assert.equal((await access(a1)).sources.filter((s) => s.permissionKey === 'admin.withdrawal.approve').length, 1);
  const page = (await sql("SELECT public.list_staff_employees('Chen staff fixture','active',1,25) AS value")).rows[0].value;
  assert.equal(page.total, 1); assert.equal(page.items[0].id, chen);
  await assert.rejects(() => sql('SELECT public.list_staff_employees(NULL,NULL,1,NULL)'), /invalid_staff_employee_query/);
  await assert.rejects(() => sql("SELECT public.validate_staff_module_keys(ARRAY['unsupported_staff_test'])"), /staff_module_not_delegable/);
  await sql('SELECT public.revoke_staff_role_assignment($1,$2)', [a1, 'Employee transferred to another team']);
  assert.equal((await sql('SELECT revoked_at IS NOT NULL AS value FROM public.staff_role_assignments WHERE id=$1', [a1])).rows[0].value, true);
  assert.equal((await sql('SELECT revoked_at IS NULL AS value FROM public.staff_role_assignments WHERE id=$1', [b1])).rows[0].value, true);
  assert.equal((await sql("SELECT count(*)::int AS n FROM public.audit_logs WHERE action='staff.role.revoked' AND entity_id=$1", [a1])).rows[0].n, 1);
  assert.equal((await sql('SELECT count(*)::int AS n FROM public.users WHERE id=$1', [chen])).rows[0].n, 1);
  await assert.rejects(() => sql('SELECT public.revoke_staff_role_assignment($1,$2)', [a1, 'Employee transferred to another team']), /staff_assignment_already_revoked/);
  await as('authenticated', chen);
  assert.equal(await allowed('admin.withdrawal.approve'), true);
  assert.equal((await sql('SELECT app_private.can_review_recommendation($1) AS value', [chen])).rows[0].value, true);
  await assert.rejects(() => sql('SELECT app_private.admin_link_vendor_recommendation($1,$2)', [crypto.randomUUID(),crypto.randomUUID()]), /admin_required/);
  await assert.rejects(() => access(), /super_admin_required/);

  // Execute the actual unchanged financial transaction with delegated Staff authority.
  const withdrawal = crypto.randomUUID();
  const wallet = (await sql('INSERT INTO public.wallets(user_id,reserved_earnings_sen) VALUES($1,5000) RETURNING id', [li])).rows[0].id;
  await sql('INSERT INTO public.withdrawal_requests(id,user_id,wallet_id,amount) VALUES($1,$2,$3,50)', [withdrawal, li, wallet]);
  await sql("INSERT INTO public.withdrawal_approvals(request_id,approver_id,action,note) VALUES($1,$2,'approve','Historical approval retained')", [withdrawal, chen]);
  await as('service_role', chen);
  await sql("SELECT public.reject_wallet_withdrawal_server($1,$2,'Reviewed and rejected by delegated employee',NULL,'review_completed')", [chen, withdrawal]);
  assert.equal((await sql('SELECT earnings_sen::int AS amount FROM public.wallets WHERE id=$1', [wallet])).rows[0].amount, 5000);
  assert.equal((await sql('SELECT count(*)::int AS n FROM public.withdrawal_approvals WHERE request_id=$1', [withdrawal])).rows[0].n, 2);
  await as('authenticated');
  await sql('SELECT public.revoke_staff_role_assignment($1,$2)', [a2, 'Withdraw delegated wallet responsibilities']);
  await sql('SELECT public.revoke_staff_role_assignment($1,$2)', [reviewAssignment, 'Withdraw delegated review responsibilities']);
  await as('authenticated', chen);
  assert.equal(await allowed('admin.withdrawal.approve'), false);
  assert.equal((await sql('SELECT app_private.can_review_recommendation($1) AS value', [chen])).rows[0].value, false);
  assert.equal((await sql('SELECT count(*)::int AS n FROM public.withdrawal_approvals WHERE request_id=$1', [withdrawal])).rows[0].n, 2);
  await sql("INSERT INTO public.user_roles(user_id,role_id) SELECT $1,id FROM public.roles WHERE name='approver'", [chen]);
  await as('authenticated');
  assert.ok((await access()).sources.some((s) => s.sourceType === 'legacy_role' && s.sourceName === 'approver'));
  assert.equal((await sql("SELECT has_table_privilege('authenticated','public.user_roles','INSERT') AS value")).rows[0].value, false);
  await sql('SET ROLE authenticated');
  try { await assert.rejects(() => sql('DELETE FROM public.user_roles WHERE user_id=$1', [chen]), { code: '42501' }); }
  finally { await sql('RESET ROLE'); }
  await sql("UPDATE public.users SET status='suspended' WHERE id=$1", [boss]);
  await assert.rejects(() => access(), /super_admin_required/);
  await sql("UPDATE public.users SET status='active' WHERE id=$1", [boss]);
  await sql("SELECT set_config('request.test.staff_verified','false',false)");
  assert.equal((await sql('SELECT app_private.is_super_admin($1) AS value', [boss])).rows[0].value, false);
  await assert.rejects(() => access(), /staff_passkey_required/);
  await sql('SET ROLE anon');
  try { await assert.rejects(() => access(), { code: '42501' }); }
  finally { await sql('RESET ROLE'); }
  console.log('PASS staff governance: source union, preview, individual revoke/history/audit, delegated rejection, immediate revocation, pagination, browser ACL, assurance');
}
