import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => key === 'transactions.quantityAndLines'
      ? `Quantity: ${values?.quantity} · ${values?.count} ${values?.lineLabel}`
      : key === 'transactions.paymentDetails' ? `${values?.provider} · ${values?.mode}`
        : key === 'transactions.line' ? 'line' : key === 'transactions.lines' ? 'lines' : key,
    i18n: { resolvedLanguage: 'en' },
  }),
}));

import RecentTransactions, { type RecentOrder } from '@/components/vendor/recent-transactions';

describe('recent transaction product photos', () => {
  it('renders the matching product cover beside its name without dropping quantity details', () => {
    const order = {
      order_id: 'order-1',
      display_id: 'ORD-1',
      created_at: '2026-10-04T09:00:00.000Z',
      product_name: 'Fried Wantan',
      productType: 'food',
      coverUrl: 'https://images.example/fried-wantan.jpg',
      outlet_name: 'Lebuh Keng Kwee',
      outlet_id: 'outlet-1',
      outlet_location: 'George Town, Penang',
      order_total: 9.9,
      order_amount: 9.9,
      quantity: 1,
      item_count: 1,
      fulfil_status: 'pending',
      order_status: 'paid',
      payment: { status: 'succeeded', mode: 'demo', provider: 'demo' },
      items: [],
    } satisfies RecentOrder;

    const markup = renderToStaticMarkup(<RecentTransactions items={[order]} />);

    expect(markup).toContain('src="https://images.example/fried-wantan.jpg"');
    expect(markup).toContain('alt="Fried Wantan"');
    expect(markup).toContain('Quantity: 1 · 1 line');
  });

  it('shows discounted order amount, item subtotal, payment mode, and fulfilment separately', () => {
    const order = {
      order_id: 'order-2',
      display_id: 'ORD-2',
      created_at: '2026-10-04T09:00:00.000Z',
      product_name: 'Fried Wantan',
      outlet_name: 'Lebuh Keng Kwee',
      outlet_id: 'outlet-1',
      outlet_location: 'George Town, Penang',
      order_total: 19.8,
      order_amount: 17.82,
      quantity: 1,
      item_count: 1,
      fulfil_status: 'fulfilled',
      order_status: 'completed',
      payment: { status: 'succeeded', mode: 'test', provider: 'stripe' },
      items: [],
    } satisfies RecentOrder;

    const markup = renderToStaticMarkup(<RecentTransactions items={[order]} />);

    expect(markup).toContain('transactions.payment');
    expect(markup).toContain('transactions.paymentModes.test');
    expect(markup).toContain('transactions.fulfilment');
    expect(markup).toContain('17.82');
    expect(markup).toContain('19.80');
    expect(markup).not.toContain('RM19.80</td>');
  });
});
