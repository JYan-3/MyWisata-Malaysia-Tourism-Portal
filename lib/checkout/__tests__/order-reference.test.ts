import { describe, expect, it } from 'vitest';
import { formatOrderReference, parseOrderReference } from '../order-reference';

describe('guest order references', () => {
  it('accepts a full public order number case-insensitively', () => {
    expect(parseOrderReference(' #ord-1000 ')).toEqual({ kind: 'displayId', value: 'ORD-1000' });
  });

  it('preserves a complete UUID lookup for existing recovery links', () => {
    expect(parseOrderReference('1d4057cf-c821-4b05-a454-61dbdc42d32c')).toEqual({
      kind: 'id', value: '1d4057cf-c821-4b05-a454-61dbdc42d32c',
    });
  });

  it('rejects short UUIDs and ambiguous partial public references', () => {
    expect(parseOrderReference('1D4057CF')).toBeNull();
    expect(parseOrderReference('1000')).toBeNull();
  });

  it('uses the complete public number and falls back to the UUID for legacy rows', () => {
    expect(formatOrderReference('uuid', 'ORD-KL-SEED')).toBe('ORD-KL-SEED');
    expect(formatOrderReference('uuid', null)).toBe('uuid');
  });
});
