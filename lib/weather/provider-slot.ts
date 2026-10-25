type ProviderSlotGateOptions = {
  maxRunning: number;
  maxWaiters: number;
};

export function createProviderSlotGate({ maxRunning, maxWaiters }: ProviderSlotGateOptions) {
  let running = 0;
  const waiters: Array<{
    resolve: (acquired: boolean) => void;
    cancel: () => void;
    signal?: AbortSignal;
  }> = [];

  function startNext() {
    while (waiters.length > 0) {
      const waiter = waiters.shift()!;
      waiter.signal?.removeEventListener("abort", waiter.cancel);
      if (waiter.signal?.aborted) {
        waiter.resolve(false);
        continue;
      }
      running += 1;
      waiter.resolve(true);
      return;
    }
  }

  async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) return null;
    if (running >= maxRunning) {
      if (waiters.length >= maxWaiters) return null;
      const acquired = await new Promise<boolean>((resolve) => {
        const waiter = {
          resolve,
          signal,
          cancel: () => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            signal?.removeEventListener("abort", waiter.cancel);
            resolve(false);
          },
        };
        waiters.push(waiter);
        signal?.addEventListener("abort", waiter.cancel, { once: true });
      });
      if (!acquired) return null;
    } else {
      running += 1;
    }

    try {
      return signal?.aborted ? null : await work();
    } finally {
      running -= 1;
      startNext();
    }
  }

  function resetForTests() {
    running = 0;
    for (const waiter of waiters.splice(0)) {
      waiter.signal?.removeEventListener("abort", waiter.cancel);
      waiter.resolve(false);
    }
  }

  return { run, resetForTests };
}

const forecastProviderGate = createProviderSlotGate({ maxRunning: 3, maxWaiters: 12 });

export function withWeatherForecastProviderSlot<T>(work: () => Promise<T>, signal?: AbortSignal) {
  return forecastProviderGate.run(work, signal);
}

export function resetWeatherProviderSlots() {
  forecastProviderGate.resetForTests();
}
