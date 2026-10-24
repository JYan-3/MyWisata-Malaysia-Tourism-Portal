import { expect, it } from 'vitest';
import { resetWeatherProviderSlots, withWeatherForecastProviderSlot } from '../provider-slot';

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
