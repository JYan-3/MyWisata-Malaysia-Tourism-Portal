#!/usr/bin/env node
/** Service-only operations: inspect by default; resolve only with verified evidence. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try { process.loadEnvFile('.env.local'); } catch { /* Hosting may inject environment. */ }
const args = process.argv.slice(2);
const value = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const flags = new Set(['--resolve','--id','--token','--updated-at','--actor','--decision','--evidence-file','--message-id']);
try {
  for (let i = 0; i < args.length; i++) {
    if (!flags.has(args[i])) throw new Error('invalid_arguments');
    if (args[i] !== '--resolve') { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('invalid_arguments'); i++; }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('service_configuration_required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!args.includes('--resolve')) {
    const { data, error } = await db.rpc('inspect_email_outbox_delivery');
    if (error) throw new Error('delivery_inspection_unavailable');
    // Contains attempt metadata only: no contact addresses, payloads or credentials.
    console.log(JSON.stringify(data, null, 2));
  } else {
    if (process.env.EMAIL_DELIVERY_RECOVERY_WRITE !== '1') throw new Error('explicit_recovery_write_required');
    const id = value('--id'), actor = value('--actor'), updated = value('--updated-at'), decision = value('--decision');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id ?? '') || !uuid.test(actor ?? '') || !updated || !['delivered','retry'].includes(decision)) throw new Error('invalid_recovery_parameters');
    const token = value('--token');
    if (token && !uuid.test(token)) throw new Error('invalid_claim_token');
    const file = value('--evidence-file');
    if (!file) throw new Error('evidence_file_required');
    const evidence = readFileSync(file, 'utf8').trim();
    if (evidence.length < 20 || evidence.length > 500) throw new Error('delivery_evidence_required');
    const messageId = value('--message-id');
    if (decision === 'delivered' && !messageId) throw new Error('verified_message_id_required');
    const { data, error } = await db.rpc('resolve_email_outbox_delivery', {
      p_id: id, p_token: token, p_updated_at: updated, p_actor: actor,
      p_decision: decision, p_evidence: evidence, p_message_id: messageId,
    });
    if (error || data !== true) throw new Error('delivery_recovery_rejected');
    console.log(JSON.stringify({ resolved: true, decision }));
  }
} catch (error) {
  const safe = new Set(['invalid_arguments','service_configuration_required','delivery_inspection_unavailable',
    'explicit_recovery_write_required','invalid_recovery_parameters','invalid_claim_token','evidence_file_required',
    'delivery_evidence_required','verified_message_id_required','delivery_recovery_rejected']);
  console.error(safe.has(error?.message) ? error.message : 'email_delivery_operation_failed');
  process.exitCode = 1;
}
