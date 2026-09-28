import { describe, expect, it, vi, afterEach } from 'vitest';
import { log } from '@/lib/log';

describe('log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes info/warn to console.log/console.warn as a single JSON line', () => {
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'hello', { userId: 'u1' });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: 'info', message: 'hello', userId: 'u1' });
    expect(typeof parsed.ts).toBe('string');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log('warn', 'careful');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('writes error level to console.error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log('error', 'boom', { requestId: 'req-1', code: 'X' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: 'error', message: 'boom', requestId: 'req-1', code: 'X' });
  });

  it('falls back to a plain line instead of throwing on non-serializable fields', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => log('error', 'bad field', { circular })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: 'error', message: 'bad field' });
    expect(parsed.fieldsError).toBeTruthy();
  });
});
