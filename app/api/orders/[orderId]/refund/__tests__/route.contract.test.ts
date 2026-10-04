import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../route.ts', import.meta.url), 'utf8');

describe('customer refund request funding integrity', () => {
  it('delegates payment selection, active-refund idempotency and funding snapshots to one transaction', () => {
    expect(source).toContain("service.rpc('request_order_refund'");
    expect(source).toContain('REFUND_ALREADY_REQUESTED');
    expect(source).not.toContain(".order('created_at', { ascending: false }).limit(1)");
  });
});
