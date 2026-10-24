vi.mock('@/lib/platform/operations-settings', () => ({ ensureCustomEmailDeliveryEnabled: vi.fn().mockResolvedValue(undefined) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), pdf: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mocks.send, close: vi.fn() }) } }));
vi.mock('../config', () => ({ getEmailConfig: () => ({ host: 'smtp.example.test', port: 587, user: 'test', pass: 'test', from: 'test@example.test' }) }));
vi.mock('@/lib/pdf/receipt', () => ({ generateReceiptPdf: mocks.pdf }));
import { sendOrderReceiptEmail } from '../order-receipt';

describe('receipt email recipient language', () => {
  beforeEach(() => { mocks.send.mockResolvedValue({ messageId: 'test-only', accepted: ['test@example.test'], rejected: [] }); mocks.pdf.mockResolvedValue(Buffer.from('test-pdf')); });
  it.each([['zh-CN', '订单收据', '总额'], ['ms', 'Resit Pesanan', 'Jumlah']] as const)('uses %s in mail and the attached receipt', async (locale, subject, total) => {
    await sendOrderReceiptEmail({ locale, recipientEmail: 'test@example.test', recipientName: '陈小明', orderId: 'MW-12345678', createdAt: '2026-10-14T00:00:00Z', paymentMethod: 'stripe_card', items: [{ activityName: 'Cake <Shop>', variantLabel: '原味', unitPrice: 25, qty: 1 }], subtotal: 25, total: 25, discount: 0 });
    expect(mocks.pdf).toHaveBeenLastCalledWith(expect.objectContaining({ locale }));
    const mail = mocks.send.mock.calls.at(-1)![0];
    expect(mail.subject).toContain(subject);
    expect(mail.html).toContain(`lang="${locale}"`);
    expect(mail.html).toContain('Cake &lt;Shop&gt;');
    expect(mail.text).toContain(total);
    expect(mail.html).toContain(total);
    expect(mail.attachments).toHaveLength(1);
  });
});
