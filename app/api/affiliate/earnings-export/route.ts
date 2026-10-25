// P4 — Member 4: affiliate earnings export. CLAUDE-P4-EXTRAS-2.md Extra 6.
// GET /api/affiliate/earnings-export?range=month|year|all — a downloadable
// CSV of the CURRENT user's own commission history. Own data only: userId
// comes from the authenticated session below, never from a request
// parameter, and lib/affiliate/earnings-export.ts's query is additionally
// scoped by real own-row RLS on affiliate_links/_clicks/_attributions
// regardless.
//
// Returns a raw text/csv Response, not the repo's apiOk() JSON envelope —
// same class of exception as app/api/share-image/[type]/[id]/route.tsx's
// raw ImageResponse: a file download can't be wrapped in a JSON envelope
// and still trigger a browser save-file dialog. Error paths still use
// apiFail(), matching that same precedent.

import { createClient } from '@/lib/supabase/server';
import { apiFail } from '@/lib/validation/schemas';
import { csvRow } from '@/lib/admin/csv';
import { getAffiliateEarningsExportPages, type EarningsExportRange, type EarningsExportRow } from '@/lib/affiliate/earnings-export';
import {
  customerCapabilityFailure,
  resolveServerCustomerCapability,
} from '@/lib/auth/customer-capabilities.server';

const VALID_RANGES: EarningsExportRange[] = ['month', 'year', 'all'];
const CSV_HEADER = ['Date', 'Activity', 'Order Reference', 'Order Amount (RM)', 'Commission Rate (%)', 'Commission Amount (RM)', 'Status', 'Cleared Date'];

function isoDate(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const decision = await resolveServerCustomerCapability(user.id, 'affiliate.earn_commission');
  const failure = customerCapabilityFailure(
    'affiliate.earn_commission',
    decision,
    'Complete KYC verification to export Affiliate earnings',
  );
  if (failure) return failure;

  const rangeParam = new URL(request.url).searchParams.get('range');
  const range: EarningsExportRange = VALID_RANGES.includes(rangeParam as EarningsExportRange)
    ? (rangeParam as EarningsExportRange)
    : 'all';

  const iterator = getAffiliateEarningsExportPages(supabase, user.id, range);
  let firstPage: IteratorResult<EarningsExportRow[], void>;
  try {
    firstPage = await iterator.next();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'affiliate_earnings_export_unavailable';
    return apiFail(
      reason === 'affiliate_earnings_export_limit_exceeded' ? 'EXPORT_LIMIT_EXCEEDED' : 'EXPORT_UNAVAILABLE',
      reason === 'affiliate_earnings_export_limit_exceeded'
        ? 'The selected export exceeds the supported row limit. Narrow the date range and try again.'
        : 'Affiliate earnings export is temporarily unavailable',
      reason === 'affiliate_earnings_export_limit_exceeded' ? 413 : 503,
    );
  }

  const encoder = new TextEncoder();
  let includeHeader = true;
  let firstPagePending = true;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = firstPagePending ? firstPage : await iterator.next();
        firstPagePending = false;
        if (result.done) {
          if (includeHeader) {
            controller.enqueue(encoder.encode(`﻿${csvRow(CSV_HEADER)}\r\n`));
            includeHeader = false;
          }
          controller.close();
          return;
        }
        const lines = result.value.map((row) => csvRow([
          isoDate(row.date),
          row.productName,
          row.orderReference,
          row.orderAmount !== null ? row.orderAmount.toFixed(2) : '',
          (row.commissionRate * 100).toFixed(2),
          row.commissionAmount.toFixed(2),
          row.status,
          isoDate(row.clearedAt),
        ]));
        const prefix = includeHeader ? `﻿${csvRow(CSV_HEADER)}\r\n` : '';
        includeHeader = false;
        controller.enqueue(encoder.encode(`${prefix}${lines.length ? `${lines.join('\r\n')}\r\n` : ''}`));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });

  const fileName = `mylawatan-affiliate-earnings-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
