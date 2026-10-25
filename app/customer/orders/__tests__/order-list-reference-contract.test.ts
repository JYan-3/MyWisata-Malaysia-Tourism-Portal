import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(process.cwd(), 'app/customer/orders/page.tsx'), 'utf8');

describe('customer order list references', () => {
  it('searches and displays the complete public reference with UUID fallback', () => {
    expect(pageSource).toContain('formatOrderReference(order.id, order.displayId)');
    expect(pageSource).toContain('order.displayId');
    expect(pageSource).not.toContain('shortOrderId(order.id)');
  });
});
