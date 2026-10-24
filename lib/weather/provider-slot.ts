const MAX_RUNNING = 3;
const MAX_WAITERS = 12;
let running = 0;
const waiters: Array<() => void> = [];

export async function withWeatherForecastProviderSlot<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) return null;
  if (running >= MAX_RUNNING) {
    if (waiters.length >= MAX_WAITERS) return null;
    const acquired = await new Promise<boolean>((resolve) => {
      const start = () => { signal?.removeEventListener('abort', cancel); running++; resolve(true); };
      const cancel = () => { const index = waiters.indexOf(start); if (index >= 0) waiters.splice(index, 1); resolve(false); };
      waiters.push(start);
      signal?.addEventListener('abort', cancel, { once: true });
    });
    if (!acquired) return null;
  } else running++;
  try { return signal?.aborted ? null : await work(); }
  finally { running--; waiters.shift()?.(); }
}

export function resetWeatherProviderSlots() { running = 0; waiters.splice(0); }
