'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { formatDate, formatMYR, formatNumber } from '@/lib/i18n/format';
import { DEFAULT_LOCALE, isAppLocale } from '@/lib/i18n/locale';
import CenteredDetailModal from '@/components/ui/centered-detail-modal';
import CompactThumbnail from '@/components/vendor/compact-thumbnail';
import type { DashboardPaymentSummary } from '@/lib/vendor/dashboard-metrics';
import type { TFunction } from 'i18next';

export interface RecentItem { id: string; product_name: string; quantity: number; line_total: number; fulfil_status: string; outlet_name: string; outlet_id?: string; outlet_location?: string }
export interface RecentOrder { order_id: string; display_id?: string | null; created_at: string; product_name: string; productType?: string | null; coverUrl?: string | null; outlet_name: string; outlet_id?: string; outlet_location?: string; order_total: number; order_amount: number; quantity: number; item_count: number; fulfil_status: string; order_status: string; payment: DashboardPaymentSummary; items: RecentItem[] }

function paymentStatusTranslationKey(status: string) {
  if (['succeeded', 'pending', 'failed', 'processing', 'mixed', 'not_recorded'].includes(status)) return status;
  return 'other';
}

function paymentSourceLabel(t: TFunction<'vendor'>, payment: DashboardPaymentSummary) {
  const mode = t(`transactions.paymentModes.${payment.mode}`);
  if (payment.mode === 'demo' && payment.provider === 'demo') return mode;
  if (payment.mode === 'mixed' || payment.mode === 'unknown') return mode;
  return t('transactions.paymentDetails', { provider: t(`transactions.paymentProviders.${payment.provider}`), mode });
}

export default function RecentTransactions({ items }: { items: RecentOrder[] }) {
  const { t, i18n } = useTranslation('vendor');
  const locale = isAppLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LOCALE;
  const [selected, setSelected] = useState<RecentOrder | null>(null);

  return <>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-gray-100">
          <tr className="text-gray-500">
            <th className="px-6 py-4 font-medium">{t('transactions.orderAndDate')}</th>
            <th className="px-6 py-4 font-medium">{t('transactions.items')}</th>
            <th className="px-6 py-4 font-medium">{t('transactions.outlet')}</th>
            <th className="px-6 py-4 text-right font-medium">{t('transactions.vendorTotal')}</th>
            <th className="px-6 py-4 font-medium">{t('transactions.paymentAndFulfilment')}</th>
            <th className="px-6 py-4 text-right font-medium">{t('transactions.action')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {items.map((item) => (
            <tr key={item.order_id} className="group hover:bg-gray-50/60">
              <td className="px-6 py-4">
                <div className="font-mono text-xs font-semibold text-gray-900">{item.display_id || `#${item.order_id.slice(0, 8)}`}</div>
                <div className="mt-1 text-xs text-gray-500">{formatDate(item.created_at, locale)}</div>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <CompactThumbnail src={item.coverUrl} alt={item.product_name} kind={item.productType === 'food' ? 'food' : ['activity', 'experience', 'service'].includes(item.productType ?? '') ? 'experience' : 'product'} size="sm" />
                  <span className="font-medium text-gray-900">{item.product_name}</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">{t('transactions.quantityAndLines', { quantity: formatNumber(item.quantity, locale), count: formatNumber(item.item_count, locale), lineLabel: t(item.item_count === 1 ? 'transactions.line' : 'transactions.lines') })}</div>
              </td>
              <td className="px-6 py-4">
                <p className="font-medium text-gray-700">{item.outlet_name}</p>
                <p className="mt-1 text-xs text-gray-400">{t('strictMigration.outletMeta', { location: item.outlet_location, id: item.outlet_id?.slice(0, 8).toUpperCase() })}</p>
              </td>
              <td className="px-6 py-4 text-right">
                <p className="font-semibold text-gray-900">{formatMYR(Number(item.order_amount), locale, { minimumFractionDigits: 2 })}</p>
                <p className="mt-1 text-xs font-normal text-gray-500"><span>{t('transactions.itemsSubtotal')}</span> <span>{formatMYR(Number(item.order_total), locale, { minimumFractionDigits: 2 })}</span></p>
              </td>
              <td className="px-6 py-4">
                <div className="space-y-1.5">
                  <p className="flex flex-wrap gap-x-1 text-xs"><span className="font-medium text-gray-500">{t('transactions.paymentStatus')}</span><span className="font-semibold text-gray-800">{t(`transactions.paymentStatuses.${paymentStatusTranslationKey(item.payment.status)}`)}</span></p>
                  <p className="flex flex-wrap gap-x-1 text-xs text-gray-500"><span>{t('transactions.paymentSource')}</span><span>{paymentSourceLabel(t, item.payment)}</span></p>
                  <div className="flex items-center gap-2 text-xs"><span className="font-medium text-gray-500">{t('transactions.fulfilment')}</span><StatusBadge status={item.fulfil_status} /></div>
                </div>
              </td>
              <td className="px-6 py-4 text-right">
                <button type="button" onClick={() => setSelected(item)} className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-primary hover:bg-secondary/80"><Eye size={14} /> {t('transactions.view')}</button>
              </td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={6} className="px-6 py-14 text-center text-gray-400">{t('transactions.empty')}</td></tr>}
        </tbody>
      </table>
    </div>
    {selected && (
      <CenteredDetailModal eyebrow={t('transactions.recentOrder')} title={selected.display_id || `#${selected.order_id.slice(0, 8)}`} closeLabel={t('transactions.close')} onClose={() => setSelected(null)}>
        <div className="mt-6 rounded-xl border border-gray-100 p-4">
          <p className="flex flex-wrap gap-x-1 text-sm font-semibold text-gray-900"><span>{t('transactions.paymentStatus')}</span><span>{t(`transactions.paymentStatuses.${paymentStatusTranslationKey(selected.payment.status)}`)}</span></p>
          <p className="mt-1 flex flex-wrap gap-x-1 text-sm text-gray-600"><span>{t('transactions.paymentSource')}</span><span>{paymentSourceLabel(t, selected.payment)}</span></p>
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-600"><span>{t('transactions.fulfilment')}</span><StatusBadge status={selected.fulfil_status} /></div>
        </div>
        <div className="mt-4 space-y-3">
          {selected.items.map((item) => (
            <div key={item.id} className="rounded-xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{formatNumber(item.quantity, locale)}× {item.product_name}</p>
                  <p className="mt-1 text-xs text-gray-500">{item.outlet_name}</p>
                  <p className="mt-1 font-mono text-[10px] text-gray-400">{t('strictMigration.outletMeta', { location: item.outlet_location, id: item.outlet_id?.slice(0, 8).toUpperCase() })}</p>
                </div>
                <p className="font-semibold text-gray-900">{formatMYR(Number(item.line_total), locale, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="mt-3"><StatusBadge status={item.fulfil_status} /></div>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-xl bg-gray-50 p-4">
          <p className="text-xs text-gray-500">{t('transactions.vendorTotal')}</p>
          <p className="mt-1 text-2xl font-bold text-gray-950">{formatMYR(Number(selected.order_amount), locale, { minimumFractionDigits: 2 })}</p>
          <p className="mt-2 flex flex-wrap gap-x-1 text-xs text-gray-500"><span>{t('transactions.itemsSubtotal')}</span><span>{formatMYR(Number(selected.order_total), locale, { minimumFractionDigits: 2 })}</span></p>
          <p className="mt-2 text-xs text-gray-500">{t('strictMigration.orderStatusValue', { status: selected.order_status })}</p>
        </div>
      </CenteredDetailModal>
    )}
  </>;
}
