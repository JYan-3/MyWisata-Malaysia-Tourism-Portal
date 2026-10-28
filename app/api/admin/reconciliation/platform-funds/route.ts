// Platform funds on Order Breakdown: money still owed to others, platform earnings on confirmed
// settlements, and the append-only log of transfers to the company's operating account.
// Authorization, the over-limit block and the audit trail live in the database functions
// (migration 20261025235303), which run as the signed-in Super Admin.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { apiFail, apiOk, databaseUuidSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const recordSchema = z.object({
  action: z.literal('record'),
  amountSen: z.number().int().positive().max(1_000_000_000),
  transferredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().trim().min(3).max(120),
  note: z.string().trim().max(500).optional(),
}).strict();

const voidSchema = z.object({
  action: z.literal('void'),
  id: databaseUuidSchema,
  reason: z.string().trim().min(5).max(500),
}).strict();

function failure(error: { message?: string } | null) {
  const message = error?.message ?? '';
  if (message.includes('super_admin_required')) return apiFail('FORBIDDEN', 'Super Admin access required', 403);
  if (message.includes('exceeds_available')) return apiFail('EXCEEDS_AVAILABLE', 'This is more than the platform has available to transfer', 409);
  if (message.includes('not_found')) return apiFail('NOT_FOUND', 'Transfer not found or already voided', 404);
  if (message.includes('platform_transfer_invalid')) return apiFail('VALIDATION_FAILED', 'Check the amount, date and reference', 422);
  return apiFail('PLATFORM_FUNDS_UNAVAILABLE', 'Platform funds are unavailable right now', 503);
}

export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const { data, error } = await db.rpc('get_platform_funds');
  if (error) return failure(error);
  return apiOk(data);
}

export async function POST(request: Request) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const parsed = z.discriminatedUnion('action', [recordSchema, voidSchema]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'Check the amount, date and reference', 422);

  const { data, error } = parsed.data.action === 'record'
    ? await db.rpc('record_platform_transfer', {
      p_amount_sen: parsed.data.amountSen,
      p_transferred_on: parsed.data.transferredOn,
      p_reference: parsed.data.reference,
      p_note: parsed.data.note || null,
    })
    : await db.rpc('void_platform_transfer', { p_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return failure(error);
  return apiOk(data);
}
