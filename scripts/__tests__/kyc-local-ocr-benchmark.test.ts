import { describe, expect, it } from 'vitest';
import { summarizeOcrSample, summarizeDurations } from '../lib/kyc-local-ocr-benchmark.mjs';

describe('synthetic local OCR measurement', () => {
  it('checks literal expected fields without treating any result as identity approval', () => {
    const result = summarizeOcrSample('NAME\nNAMA CONTOH UJIAN\n990101-14-0001', {
      name: 'Nama Contoh Ujian', number: '990101140001',
    });
    expect(result).toEqual({ namePresent: true, numberPresent: true });
    expect(result).not.toHaveProperty('approved');
    expect(result).not.toHaveProperty('text');
  });
  it('does not mistake a nearly correct identifier for an exact match', () => {
    expect(summarizeOcrSample('Nama Contoh Ujian\n990101-14-0007', {
      name: 'Nama Contoh Ujian', number: '990101140001',
    })).toEqual({ namePresent: true, numberPresent: false });
  });
  it('handles Chinese spacing but does not invent absent fields', () => {
    expect(summarizeOcrSample('测 试 样 本 姓 名', {
      name: '测试样本姓名', number: '990101140001',
    })).toEqual({ namePresent: true, numberPresent: false });
  });
  it('reports sample counts and observed latency without estimating daily capacity', () => {
    expect(summarizeDurations([100, 300, 200])).toEqual({ samples: 3, meanMs: 200, medianMs: 200, maxMs: 300 });
    expect(summarizeDurations([])).toEqual({ samples: 0, meanMs: null, medianMs: null, maxMs: null });
  });
});
