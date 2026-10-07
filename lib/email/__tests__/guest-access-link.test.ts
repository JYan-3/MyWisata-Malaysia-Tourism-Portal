import {describe,it,expect} from 'vitest';
import {renderTransactionEmail} from '../templates';
describe('guest access link email',()=>{
 it('escapes labels and links while keeping the secret in a URL fragment',()=>{
  const url='https://mywisata.example/customer/orders/access#token='+'A'.repeat(43);
  const output=renderTransactionEmail({eventType:'checkout_succeeded',recipientName:'<script>bad</script>',amountRm:10,reference:'order',occurredAt:'2026-10-02T00:00:00Z',accessUrl:url});
  expect(output.html).toContain('View your order');expect(output.html).toContain(url);expect(output.html).not.toContain('<script>bad</script>');expect(output.text).toContain(url);expect(output.html).not.toContain('?token=');
 });
});
