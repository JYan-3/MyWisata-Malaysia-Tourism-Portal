import { expect, it } from 'vitest';
import { createProviderSlotGate, resetWeatherProviderSlots, withWeatherForecastProviderSlot } from '../provider-slot';

it('bounds actual weather work, limits waiting and cancels queued callers', async () => {
  resetWeatherProviderSlots();
  const finish: Array<() => void> = [];
  let active = 0, peak = 0;
  const work = async () => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>((resolve) => finish.push(resolve)); active--; return true;
  };
  const running = Array.from({ length: 3 }, () => withWeatherForecastProviderSlot(work));
  const controllers = Array.from({ length: 12 }, () => new AbortController());
  const queued = controllers.map((controller) => withWeatherForecastProviderSlot(work, controller.signal));
  expect(await withWeatherForecastProviderSlot(work)).toBeNull();
  controllers.forEach((controller) => controller.abort());
  expect(await Promise.all(queued)).toEqual(Array(12).fill(null));
  finish.forEach((resolve) => resolve()); await Promise.all(running);
  expect(peak).toBe(3);
  expect(await withWeatherForecastProviderSlot(async () => 42)).toBe(42);
});

it('keeps provider pools independent and releases a slot after provider failure', async () => {
  const first = createProviderSlotGate({ maxRunning: 1, maxWaiters: 1 });
  const second = createProviderSlotGate({ maxRunning: 1, maxWaiters: 0 });
  let release!: () => void;
  const blocked = first.run(() => new Promise<void>((resolve) => { release = resolve; }));
  expect(await second.run(async () => 'independent')).toBe('independent');
  const rejected = first.run(async () => { throw new Error('provider failed'); });
  expect(await first.run(async () => 'overloaded')).toBeNull();
  release();
  await blocked;
  await expect(rejected).rejects.toThrow('provider failed');
  expect(await first.run(async () => 'released')).toBe('released');
});

it('removes an aborted waiter without running its provider work', async () => {
  const gate = createProviderSlotGate({ maxRunning: 1, maxWaiters: 1 });
  let release!: () => void;
  const active = gate.run(() => new Promise<void>((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const queued = gate.run(async () => 'should not run', controller.signal);
  controller.abort();
  await expect(queued).resolves.toBeNull();
  release();
  await active;
  expect(await gate.run(async () => 'available')).toBe('available');
});
