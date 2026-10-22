const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const MAX_TRACKED_USERS = 1_000;
const MAX_WAITERS = 40;
const userRequests = new Map<string, number[]>();
const waiters: Array<() => void> = [];
let activeCalls = 0;

export function consumeRouteRateLimit(userId: string, now = Date.now()) {
  const recent = (userRequests.get(userId) ?? []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    userRequests.set(userId, recent);
    return false;
  }
  recent.push(now);
  if (!userRequests.has(userId) && userRequests.size >= MAX_TRACKED_USERS) {
    const oldestUserId = userRequests.keys().next().value;
    if (oldestUserId) userRequests.delete(oldestUserId);
  }
  userRequests.set(userId, recent);
  return true;
}

export async function withRouteProviderSlot<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) return null;
  if (activeCalls >= 4) {
    if (waiters.length >= MAX_WAITERS) return null;
    const acquired = await new Promise<boolean>((resolve)=>{
      const start=()=>{signal?.removeEventListener("abort",cancel);activeCalls+=1;resolve(true);};
      const cancel=()=>{const index=waiters.indexOf(start);if(index>=0)waiters.splice(index,1);resolve(false);};
      waiters.push(start);
      signal?.addEventListener("abort",cancel,{once:true});
    });
    if (!acquired) return null;
  } else activeCalls += 1;
  try {return signal?.aborted ? null : await work();}
  finally {
    activeCalls -= 1;
    waiters.shift()?.();
  }
}

export function __resetRouteStateForTests() {
  userRequests.clear();
  waiters.splice(0);
  activeCalls = 0;
}
