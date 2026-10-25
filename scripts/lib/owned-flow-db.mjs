import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** Disposable database only. Never load application env or accept a remote target. */
export async function withOwnedFlowDb(run) {
  const target = new URL(process.env.OWNED_FLOW_TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:55442/postgres');
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('Owned-flow SQL tests require an explicit loopback PostgreSQL target');
  }
  const database = `owned_flow_${randomUUID().replaceAll('-', '')}`;
  const clients = new Set();
  const root = new pg.Client({ connectionString: target.href, ssl: false, connectionTimeoutMillis: 5000 });
  await root.connect();
  try {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (!(await root.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) await root.query(`CREATE ROLE ${role} NOLOGIN`);
    }
    await root.query(`CREATE DATABASE ${database}`);
    const connect = async () => {
      const uri = new URL(target);
      uri.pathname = `/${database}`;
      const client = new pg.Client({ connectionString: uri.href, ssl: false, connectionTimeoutMillis: 5000 });
      await client.connect();
      clients.add(client);
      return client;
    };
    const db = await connect();
    await db.query(`CREATE SCHEMA auth; CREATE SCHEMA app_private;
      GRANT USAGE ON SCHEMA public,auth,app_private TO anon,authenticated,service_role;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;`);
    return await run({ db, connect });
  } finally {
    await Promise.allSettled([...clients].map(client => client.end()));
    await root.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await root.end();
  }
}

export async function asRole(client, role, userId) {
  if (!['anon', 'authenticated', 'service_role'].includes(role)) throw new Error('Unexpected test role');
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, sub: userId, aal: 'aal2' })]);
  await client.query(`SET ROLE ${role}`);
}
