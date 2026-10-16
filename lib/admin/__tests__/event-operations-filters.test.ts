import { describe, expect, it } from 'vitest';
import { eventOperationsQuerySchema } from '../event-operations-filters';

describe('operational query validation', () => {
  it('defaults to open work and rejects actor input, unknown fields and unbounded pages', () => {
    expect(eventOperationsQuerySchema.parse({})).toEqual({ caseSearch: '', caseKind: 'all', caseHandling: 'open', caseOwner: 'all', caseDeadline: 'all', casePage: 1 });
    for (const input of [{ actor: 'someone' }, { caseOwner: 'uuid' }, { casePage: 0 }, { casePage: '10000000000' }, { caseSearch: 'x'.repeat(101) }]) {
      expect(eventOperationsQuerySchema.safeParse(input).success).toBe(false);
    }
  });
  it('normalizes a combined query without accepting arbitrary enums', () => {
    expect(eventOperationsQuerySchema.parse({ caseSearch: ' ORD-1 ', caseOwner: 'mine', caseDeadline: 'overdue', casePage: '2' })).toMatchObject({ caseSearch: 'ORD-1', caseOwner: 'mine', casePage: 2 });
    expect(eventOperationsQuerySchema.safeParse({ caseHandling: 'processed' }).success).toBe(false);
  });
});

it('supports overdue pickup work in the existing filtering contract', () => { expect(eventOperationsQuerySchema.parse({ caseKind: 'pickup_overdue' }).caseKind).toBe('pickup_overdue'); });
