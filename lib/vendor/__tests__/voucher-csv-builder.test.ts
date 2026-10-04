import { describe, expect, it } from 'vitest';
import enVendor from '@/app/i18n/locales/en/vendor.json';
import msVendor from '@/app/i18n/locales/ms/vendor.json';
import zhVendor from '@/app/i18n/locales/zh-CN/vendor.json';
import { buildVoucherCsv, previewVoucherCodes, validateVoucherCsvDrafts, voucherCsvHeaders, type VoucherCsvDraft } from '@/lib/vendor/voucher-csv-builder';

const baseRow: VoucherCsvDraft = {
  code: '', name: 'Malaysia Welcome', voucherType: 'percent', discountValue: '15', minSpend: '30',
  maxUses: '100', perCustomerLimit: '1', validFrom: '2026-08-01T00:00', validUntil: '2026-08-31T23:59',
  outletId: '', productId: '', buyQuantity: '', freeQuantity: '', redemptionMode: 'online',
};

describe('voucher CSV builder', () => {
  it('creates a CSV with the API headers and normalized dates', () => {
    const csv = buildVoucherCsv([{ ...baseRow, name: 'Welcome, Malaysia', redemptionMode: 'in_store' }]);
    expect(csv).toContain('code,name,voucherType,redemptionMode,discountValue');
    expect(csv).toContain('"Welcome, Malaysia"');
    expect(voucherCsvHeaders).toContain('redemptionMode');
    expect(csv).toContain('in_store');
    // `datetime-local` values are interpreted in the browser's local timezone.
    // Derive the expected ISO value so the test is stable on CI's UTC runner.
    expect(csv).toContain(new Date(baseRow.validFrom).toISOString());
  });

  it('documents the redemption mode in every uploaded-file CSV template', () => {
    expect(enVendor.ui.vouchers.csvColumns).toContain('redemptionMode');
    expect(msVendor.ui.vouchers.csvColumns).toContain('redemptionMode');
    expect(zhVendor.ui.vouchers.csvColumns).toContain('redemptionMode');
  });

  it('validates BOGO product and quantity requirements before upload', () => {
    const errors = validateVoucherCsvDrafts([{ ...baseRow, voucherType: 'bogo', discountValue: '0' }]);
    expect(errors[0]).toEqual([
      'Choose an eligible product for BOGO.',
      'Enter a buy quantity.',
      'Enter a free quantity.',
    ]);
  });

  it('previews generated codes without changing explicit codes', () => {
    expect(previewVoucherCodes([
      { ...baseRow, code: '' },
      { ...baseRow, code: 'WELCOME50' },
      { ...baseRow, code: '' },
    ], 'TRAVEL')).toEqual({ generated: 2, sampleCodes: ['TRAVEL001', 'WELCOME50', 'TRAVEL002'] });
  });

  it('rejects CSV rows that violate the single-voucher creation limits', () => {
    const errors = validateVoucherCsvDrafts([{
      ...baseRow,
      minSpend: '-1',
      maxUses: '100001',
      perCustomerLimit: '1.5',
      redemptionMode: 'pickup' as VoucherCsvDraft['redemptionMode'],
    }]);

    expect(errors[0]).toEqual(expect.arrayContaining([
      'Too small: expected number to be >=0',
      'Too big: expected number to be <=100000',
      'Invalid input: expected int, received number',
      'Invalid option: expected one of "online"|"in_store"|"both"',
    ]));
  });
});
