import { z } from 'zod';
import { requireStaffAssurance } from '@/lib/auth/staff-assurance';
import { withdrawalProofFailure, withdrawalSessionId } from '@/lib/wallet/withdrawal-authorization';
import { executeApprovedWithdrawalPayout } from '@/lib/payouts/execute-approved-withdrawal';
import { scheduleTngMockCallbackAcceleration } from '@/lib/payouts/tng-mock-callbacks';
import { createServiceClient } from '@/lib/supabase/service';
import { createClient } from '@/lib/supabase/server';
import { moderateWalletAction } from '@/lib/wallet/moderation-guard';
import { requestIp } from '@/lib/wallet/request-ip';
import { walletReasonSchema } from '@/lib/validation/wallet-reason-schemas';
import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const retrySchema = z.object({
  proofId: z.string().uuid(),
  note: z.string().trim().min(10).max(500),
  reasonCategory: z.string().trim().min(1),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: withdrawalId } = await params;
  const authDb = await createClient();
  const { data: { user } } = await authDb.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const assuranceResponse = await requireStaffAssurance(authDb);
  if (assuranceResponse) return assuranceResponse;

  const { data: canApprove, error: roleError } = await authDb.rpc('has_staff_permission', { p_user_id: user.id, p_permission_key: 'admin.withdrawal.approve' });
  if (roleError || !canApprove) return apiFail('FORBIDDEN', 'Approver or Super Admin access required', 403);

  const parsed = await parseBody(request, retrySchema);
  if (!parsed.ok) return parsed.response;
  const validated = walletReasonSchema.safeParse({
    action: 'approve',
    reason: parsed.data.note,
    reasonCategory: parsed.data.reasonCategory,
  });
  if (!validated.success) {
    return apiFail('VALIDATION_FAILED', validated.error.issues[0]?.message ?? 'Invalid retry reason', 422);
  }

  const moderation = await moderateWalletAction({
    actorId: user.id,
    withdrawalId,
    action: 'approve',
    reasonCategory: validated.data.reasonCategory,
    reason: validated.data.reason,
  });
  if (!moderation.ok) {
    return apiFail(
      moderation.code,
      moderation.message,
      moderation.code === 'MODERATION_UNAVAILABLE' ? 503 : moderation.code === 'RATE_LIMITED' ? 429 : 422,
    );
  }

  const db = createServiceClient();
  const { data: withdrawal, error: withdrawalError } = await db
    .from('withdrawal_requests')
    .select('id, user_id, amount, status')
    .eq('id', withdrawalId)
    .single();
  if (withdrawalError || !withdrawal) return apiFail('NOT_FOUND', 'Withdrawal not found', 404);
  if (withdrawal.status !== 'approved') {
    return apiFail('INVALID_STATE', 'Payout can only be retried while the withdrawal remains approved. Refresh the page to review its latest status.', 409);
  }

  const sessionId = await withdrawalSessionId(authDb);
  if (!sessionId) return apiFail('WITHDRAWAL_PASSKEY_REQUIRED', 'Verify your Passkey again for this withdrawal', 403);
  const { error: retryError } = await db.rpc('authorize_staff_withdrawal_action', {
    p_withdrawal_id: withdrawalId,
    p_action: 'retry-payout',
    p_proof_id: parsed.data.proofId,
    p_payload: { note: validated.data.reason, reasonCategory: validated.data.reasonCategory },
    p_actor_id: user.id,
    p_session_id: sessionId,
    p_ip: requestIp(request),
  });
  if (retryError) {
    const message = retryError.message ?? '';
    const proofFailure = withdrawalProofFailure(message);
    if (proofFailure) return proofFailure;
    if (message.includes('self_dealing')) return apiFail('SELF_DEALING', 'You cannot retry your own withdrawal. Ask another Approver or Super Admin to process it.', 403);
    if (message.includes('withdrawal_not_retryable')) return apiFail('INVALID_STATE', 'Payout can only be retried while the withdrawal remains approved. Refresh the page to review its latest status.', 409);
    if (message.includes('payout_execution_in_progress')) return apiFail('PAYOUT_EXECUTION_IN_PROGRESS', 'Another payout attempt is active. Do not retry. Refresh the page and ask a Super Admin to reconcile it if the lock remains.', 409, { retryable: false });
    if (message.includes('payout_reconciliation_required')) return apiFail('RECONCILIATION_REQUIRED', 'This payout may already exist at the provider. Do not retry; reconcile the provider reference first.', 409, { retryable: false });
    console.error('[admin-retry-payout] record_withdrawal_payout_retry:', retryError);
    return apiFail('RETRY_AUDIT_FAILED', 'The retry could not be recorded safely. No new provider call was made; refresh the page and try again.', 500);
  }

  const execution = await executeApprovedWithdrawalPayout({
    withdrawalId,
    userId: withdrawal.user_id,
    amountRm: Number(withdrawal.amount),
  });
  if (!execution.ok) return execution.response;
  const { callbackJobId, callbackAvailableAt, ...publicResult } = execution.data;
  if (callbackJobId && callbackAvailableAt) {
    scheduleTngMockCallbackAcceleration(callbackJobId, callbackAvailableAt);
  }
  return apiOk(publicResult);
}
