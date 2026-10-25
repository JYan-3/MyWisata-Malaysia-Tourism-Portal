export type SharedProviderRequest<T> = {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
  settled: boolean;
};

export function startSharedProviderRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  onSettled?: (request: SharedProviderRequest<T>) => void,
): SharedProviderRequest<T> {
  const request: SharedProviderRequest<T> = {
    controller: new AbortController(),
    promise: Promise.resolve().then(() => run(request.controller.signal)),
    subscribers: 0,
    settled: false,
  };
  request.promise = request.promise.finally(() => {
    request.settled = true;
    onSettled?.(request);
  });
  return request;
}

export function subscribeToSharedProviderRequest<T>(
  request: SharedProviderRequest<T>,
  signal: AbortSignal | undefined,
  onNoSubscribers: () => void,
): Promise<T | null> {
  if (signal?.aborted) return Promise.resolve(null);
  request.subscribers += 1;

  return new Promise((resolve) => {
    let completed = false;
    const release = () => {
      if (completed) return false;
      completed = true;
      signal?.removeEventListener("abort", onAbort);
      request.subscribers -= 1;
      if (!request.settled && request.subscribers === 0) {
        onNoSubscribers();
        request.controller.abort();
      }
      return true;
    };
    const onAbort = () => {
      if (release()) resolve(null);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    request.promise.then((value) => {
      if (release()) resolve(value);
    }, () => {
      if (release()) resolve(null);
    });
  });
}
