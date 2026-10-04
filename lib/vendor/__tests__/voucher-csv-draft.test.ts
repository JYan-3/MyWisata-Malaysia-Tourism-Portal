import { describe, expect, it } from 'vitest';
import { emptyVoucherCsvDraft, type VoucherCsvDraft } from '@/lib/vendor/voucher-csv-builder';
import {
  getVoucherCsvDraftStorageKey,
  getVoucherCsvDraftBlockingError,
  normalizeVoucherCsvDraft,
  summarizeVoucherCsvDraft,
  type VoucherCsvDraftDocument,
} from '@/lib/vendor/voucher-csv-draft';

function documentWith(rows: VoucherCsvDraftDocument['rows']): VoucherCsvDraftDocument {
  return { title: 'Summer campaign', rows, autoGenerate: true, codePrefix: 'TRAVEL' };
}

describe('voucher CSV draft contract', () => {
  it('normalizes draft metadata without changing voucher row meaning', () => {
    const normalized = normalizeVoucherCsvDraft({
      title: '  Summer campaign  ',
      rows: [{ ...emptyVoucherCsvDraft(), name: '  Malaysia Welcome  ' }],
      autoGenerate: true,
      codePrefix: ' travel ',
    });

    expect(normalized.title).toBe('Summer campaign');
    expect(normalized.codePrefix).toBe('TRAVEL');
    expect(normalized.rows[0].name).toBe('Malaysia Welcome');
  });

  it('defaults older CSV draft rows to online redemption', () => {
    const legacyRow = { ...emptyVoucherCsvDraft(), name: 'Legacy voucher', discountValue: '10' };
    delete (legacyRow as Partial<VoucherCsvDraft>).redemptionMode;
    const normalized = normalizeVoucherCsvDraft(documentWith([legacyRow as VoucherCsvDraft]));

    expect(normalized.rows[0].redemptionMode).toBe('online');
  });

  it('summarizes rows that are ready, invalid, and missing codes', () => {
    const ready = { ...emptyVoucherCsvDraft(), code: 'WELCOME10', name: 'Welcome', discountValue: '10' };
    const missingCode = { ...ready, code: '' };
    const invalid = { ...emptyVoucherCsvDraft(), name: '', discountValue: '' };

    expect(summarizeVoucherCsvDraft(documentWith([ready, missingCode, invalid]))).toEqual({
      total: 3,
      valid: 2,
      errors: 1,
      blankCodes: 2,
    });
  });

  it('creates a vendor-scoped recovery key', () => {
    expect(getVoucherCsvDraftStorageKey('vendor/1', 'draft 2')).toBe('voucher-csv-draft:vendor%2F1:draft%202');
  });

  it('blocks preview when blank codes have no generation strategy', () => {
    expect(getVoucherCsvDraftBlockingError({ ...documentWith([{ ...emptyVoucherCsvDraft(), name: 'Welcome', discountValue: '10' }]), autoGenerate: false }))
      .toBe('Add a code or enable automatic code generation.');
  });
});
