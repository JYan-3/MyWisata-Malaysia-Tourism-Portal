import { describe, expect, it } from 'vitest';
import { classifyEmailDeliveryError, emailTransportTimeouts } from '../delivery';

describe('SMTP outcome classification', () => {
  it.each(['EDNS', 'EAUTH', 'EENVELOPE'])(
    'can retry known pre-acceptance %s failures', (code) => {
      expect(classifyEmailDeliveryError({ code, message: 'private detail' }, true).retrySafe).toBe(true);
    });
  it('can retry an explicit negative DATA response', () => {
    expect(classifyEmailDeliveryError({ code: 'EMESSAGE', command: 'DATA', responseCode: 451 }, true).retrySafe).toBe(true);
  });
  it.each(['ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'ECONNECTION', 'EMESSAGE'])('does not guess after ambiguous %s during DATA', (code) => {
    const error = classifyEmailDeliveryError({ code, command: 'DATA', message: 'recipient and SMTP credentials' }, true);
    expect(error.retrySafe).toBe(false);
    expect(error.message).toBe('email_delivery_unknown');
  });
  it('can retry a connection failure known to precede SMTP data', () => {
    expect(classifyEmailDeliveryError({ code: 'ECONNECTION', command: 'CONN' }, true).retrySafe).toBe(true);
  });
  it('can retry preparation failure before any SMTP attempt', () => {
    expect(classifyEmailDeliveryError(new Error('private detail'), false).retrySafe).toBe(true);
    expect(emailTransportTimeouts.socketTimeout).toBeLessThan(15 * 60_000);
  });
});
