import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { isRealStripeAccountId } from '@/lib/stripe/account-id';
import { retrieveConnectAccountStatus } from '@/lib/stripe/connect-status';
import { apiFail } from '@/lib/validation/schemas';
import { CUSTOMER_CAPABILITY, resolveCustomerCapability } from '@/lib/auth/customer-capabilities';
import { customerCapabilityFailure, resolveServerCustomerCapability } from '@/lib/auth/customer-capabilities.server';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

export const dynamic = 'force-dynamic';

// Note: `details.requestId` below is Stripe's OWN SDK request id (correlates one
// call to Stripe's API), distinct from `requestId` (our app's request id, from
// lib/request-id.ts) logged alongside it — both are kept for full correlation.
function stripeFailure(error: unknown, requestId: string) {
  const details = error as {
    type?: string;
    code?: string;
    param?: string;
    message?: string;
    requestId?: string;
    statusCode?: number;
  };
  log('error', '[stripe-connect-onboard] Stripe request failed', {
    requestId,
    type: details?.type ?? 'unknown',
    code: details?.code ?? null,
    param: details?.param ?? null,
    message: details?.message ?? 'unknown',
    stripeRequestId: details?.requestId ?? null,
    statusCode: details?.statusCode ?? null,
  });
  return NextResponse.json({ error: 'Unable to start Stripe onboarding', requestId }, { status: 502 });
}

function accountStatusFailure(error: unknown, requestId: string) {
  const details = error as {
    message?: string;
    requestId?: string;
    statusCode?: number;
  };
  log('error', '[stripe-connect-onboard] Stripe account status failed', {
    requestId,
    message: details?.message ?? 'unknown',
    stripeRequestId: details?.requestId ?? null,
    statusCode: details?.statusCode ?? null,
  });
  return apiFail(
    'STRIPE_ACCOUNT_UNAVAILABLE',
    'We could not verify your Stripe payout account. Please try again.',
    503,
    { requestId },
  );
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const db = await createClient();
  const { data: { user: authUser } } = await db.auth.getUser();
  if (!authUser) return customerCapabilityFailure(
    CUSTOMER_CAPABILITY.WITHDRAWAL,
    resolveCustomerCapability(null, CUSTOMER_CAPABILITY.WITHDRAWAL),
    'Sign in before setting up withdrawals',
  )!;

  const withdrawalDecision = await resolveServerCustomerCapability(
    authUser.id,
    CUSTOMER_CAPABILITY.WITHDRAWAL,
  );
  const withdrawalFailure = customerCapabilityFailure(
    CUSTOMER_CAPABILITY.WITHDRAWAL,
    withdrawalDecision,
    'KYC approval is required before setting up a withdrawal account',
  );
  if (withdrawalFailure) return withdrawalFailure;

  const { data: userRow, error: userErr } = await db
    .from('users')
    .select('stripe_connect_account_id, full_name, phone, email')
    .eq('id', authUser.id)
    .single();

  if (userErr || !userRow) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const row = userRow as {
    stripe_connect_account_id: string | null;
    full_name: string | null;
    phone: string | null;
    email: string | null;
  };

  const origin = req.headers.get('origin') ?? 'http://localhost:3000';

  let accountId = isRealStripeAccountId(row.stripe_connect_account_id)
    ? row.stripe_connect_account_id
    : null;

  if (accountId) {
    let status;
    try {
      status = await retrieveConnectAccountStatus(accountId);
    } catch (error) {
      return accountStatusFailure(error, requestId);
    }

    const { error: syncError } = await db.rpc('update_connect_status', {
      p_connect_account_id: status.accountId,
      p_payouts_enabled: status.payoutsEnabled,
    });

    if (syncError) {
      log('error', '[stripe-connect-onboard] Failed to sync payout status', {
        requestId,
        code: syncError.code ?? null,
      });
      return apiFail(
        'STRIPE_ACCOUNT_UNAVAILABLE',
        'We could not verify your Stripe payout account. Please try again.',
        503,
        { requestId },
      );
    }

    if (status.payoutsEnabled) {
      return NextResponse.json({ status: 'verified', accountId });
    }

    if (status.payoutStatus === 'pending_verification' || status.payoutStatus === 'restricted') {
      return NextResponse.json({ status: status.payoutStatus, accountId });
    }
  }

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        country: 'MY',
        email: row.email ?? authUser.email ?? undefined,
        business_type: 'individual',
        capabilities: {
          transfers: { requested: true },
        },
        controller: {
          losses: { payments: 'stripe' },
          fees: { payer: 'account' },
          requirement_collection: 'stripe',
          stripe_dashboard: { type: 'full' },
        },
        metadata: { supabase_user_id: authUser.id },
      });
      accountId = account.id;
    } catch (error) {
      return stripeFailure(error, requestId);
    }

    const { error: updateError } = await db
      .from('users')
      .update({
        stripe_connect_account_id: accountId,
        stripe_payouts_enabled: false,
      })
      .eq('id', authUser.id);

    if (updateError) {
      log('error', '[stripe-connect-onboard] Failed to persist account ID', {
        requestId,
        code: updateError.code ?? null,
      });
      return NextResponse.json({ error: 'Unable to save Stripe onboarding state', requestId }, { status: 502 });
    }
  }

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/customer/wallet?onboarding=refresh`,
      return_url: `${origin}/customer/wallet?onboarding=complete`,
      type: 'account_onboarding',
      collection_options: {
        fields: 'currently_due',
        future_requirements: 'omit',
      },
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (error) {
    return stripeFailure(error, requestId);
  }
}
