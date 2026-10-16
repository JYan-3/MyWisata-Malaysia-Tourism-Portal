import type { OrderReconciliation, OrderReconciliationRow } from './reconciliation';
import { formatMYRFromSen } from '@/lib/i18n/format';

export function formatReconciliationSen(sen: number) {
  return `${sen < 0 ? '−' : ''}${formatMYRFromSen(sen)}`;
}

export type ReconciliationFilters = { search: string; status: string; net: 'all' | 'positive' | 'zero' | 'negative' };

export function filterOrderReconciliationRows(rows: readonly OrderReconciliationRow[], filters: ReconciliationFilters) {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => (!search || (row.orderDisplayId ?? '').toLowerCase().includes(search))
    && (filters.status === 'all' || row.status === filters.status)
    && (filters.net === 'all' || (filters.net === 'positive' ? row.platformNetSen > 0 : filters.net === 'zero' ? row.platformNetSen === 0 : row.platformNetSen < 0)));
}

export function summarizeOrderReconciliationRows(rows: readonly OrderReconciliationRow[]): OrderReconciliation['totals'] {
  return rows.reduce((total, row) => ({
    grossSen: total.grossSen + row.grossSen, platformFeeSen: total.platformFeeSen + row.platformFeeSen,
    vendorNetSen: total.vendorNetSen + row.vendorNetSen, affiliatePayoutSen: total.affiliatePayoutSen + row.affiliatePayoutSen,
    recommendationPayoutSen: total.recommendationPayoutSen + row.recommendationPayoutSen,
    platformNetSen: total.platformNetSen + row.platformNetSen, negativeOrders: total.negativeOrders + Number(row.platformNetNegative),
  }), { grossSen: 0, platformFeeSen: 0, vendorNetSen: 0, affiliatePayoutSen: 0, recommendationPayoutSen: 0, platformNetSen: 0, negativeOrders: 0 });
}
