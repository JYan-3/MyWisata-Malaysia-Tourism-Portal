import { describe, expect, it } from 'vitest';
import { notificationPollDelay } from '../polling';

describe('notificationPollDelay', () => {
  it('spreads clients around the base interval', () => {
    expect(notificationPollDelay(30_000, 0, () => 0)).toBe(24_000);
    expect(notificationPollDelay(30_000, 0, () => 0.5)).toBe(30_000);
    expect(notificationPollDelay(30_000, 0, () => 1)).toBe(36_000);
  });

  it('increases delays after failures and caps backoff', () => {
    expect(notificationPollDelay(30_000, 1, () => 0.5)).toBe(60_000);
    expect(notificationPollDelay(30_000, 99, () => 0.5)).toBe(300_000);
    expect(notificationPollDelay(30_000, 0, () => -1)).toBe(24_000);
    expect(notificationPollDelay(30_000, 0, () => 2)).toBe(36_000);
  });
});
