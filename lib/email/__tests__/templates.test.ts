import { describe, expect, it } from 'vitest';
import { renderTransactionEmail, renderVendorEmail } from '@/lib/email/templates';

describe('transaction email templates', () => {
  it('renders confirmed booth approval as approval and preserves Malaysia preparation times', () => {
    const result = renderVendorEmail({ eventType: 'vendor_event_update', vendorName: 'Craft House', reason: 'Participation approved', occurredAt: '2026-10-08T00:00:00Z',
      eventChange: { kind: 'approval', eventTitle: 'November Market', locationName: 'LG1 Concourse',
        startsOn: '2026-11-01', endsOn: '2026-11-08', actionPath: '/vendor/events', reason: 'Participation approved',
        changes: [{ field: 'stallNumber', before: '', after: 'A12' }, { field: 'setupStartsAt', before: '', after: '2026-10-31 10:00' }] } });
    expect(result.subject).toContain('approved');
    expect(result.text).toContain('A12');
    expect(result.text).toContain('Setup starts:');
    expect(result.text).toContain('2026-10-31 10:00');
  });
  it('renders a top-up confirmation without sensitive fields', () => {
    const result = renderTransactionEmail({
      eventType: 'topup_succeeded',
      recipientName: 'Aina',
      amountRm: 25,
      reference: 'evt_123',
      occurredAt: '2026-07-15T10:00:00.000Z',
    });

    expect(result.subject).toContain('Top-up');
    expect(result.html).toContain('RM25.00');
    expect(result.text).toContain('evt_123');
    expect(result.html).not.toContain('990101-14-5678');
    expect(result.html).not.toContain('re_');
  });

  it('renders withdrawal statuses with stable subjects', () => {
    const result = renderTransactionEmail({
      eventType: 'withdrawal_failed',
      recipientName: null,
      amountRm: 100,
      reference: 'wd_123',
      occurredAt: '2026-07-15T10:00:00.000Z',
    });

    expect(result.subject).toBe('Withdrawal failed');
    expect(result.html).toContain('RM100.00');
    expect(result.text).toContain('wd_123');
  });
});

describe('event vendor change notices', () => {
  it('shows the old and new stall, venue and reason with an event link', () => {
    const result = renderVendorEmail({
      eventType: 'vendor_event_update', vendorName: 'Aina Kitchen',
      reason: 'Entrance layout adjustment', occurredAt: '2026-10-07T03:00:00Z',
      eventChange: {
        eventTitle: '11.11 Market', locationName: 'Sunway Pyramid, 2nd floor',
        startsOn: '2026-11-01', endsOn: '2026-11-08', actionPath: '/vendor/events',
        changes: [{ field: 'stallNumber', before: 'A12', after: 'B08' }],
        reason: 'Entrance layout adjustment',
      },
    } as never);
    expect(result.subject).toBe('Your event arrangements changed');
    expect(result.text).toContain('A12 → B08');
    expect(result.text).toContain('Sunway Pyramid, 2nd floor');
    expect(result.text).toContain('Entrance layout adjustment');
    expect(result.html).toContain('/vendor/events');
  });

  it('preserves operational addresses but hides internal identifiers and escapes HTML', () => {
    const internalId = '11111111-1111-4111-8111-111111111111';
    const result = renderVendorEmail({
      eventType: 'vendor_event_update', vendorName: `Kitchen ${internalId}`,
      reason: internalId, reference: internalId, occurredAt: '2026-10-07T03:00:00Z',
      eventChange: {
        eventTitle: '<script>bad()</script>', locationName: 'Market',
        startsOn: '2026-11-01', endsOn: '2026-11-08', actionPath: '/vendor/events',
        changes: [{ field: 'address', before: 'Address: Jalan A', after: `Address: Jalan B ${internalId}` }],
        reason: `Updated map ${internalId}`,
      },
    } as never);
    expect(result.text).toContain('Address: Jalan A');
    expect(result.text).toContain('Address: Jalan B');
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain(internalId);
    expect(result.text).not.toContain(internalId);
  });
});
