// Structured JSON-to-stdout logger. Vercel captures stdout as structured logs
// natively — no log-transport dependency needed for this deploy target.
// ponytail: JSON console logger; upgrade only if log transports or sampling
// are ever needed.

export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  const ts = new Date().toISOString();
  try {
    write(JSON.stringify({ level, message, ...fields, ts }));
  } catch {
    // A logging call must never be the thing that throws — fall back to a
    // line without the offending (e.g. circular) fields rather than losing it.
    write(JSON.stringify({ level, message, ts, fieldsError: 'unserializable fields dropped' }));
  }
}
