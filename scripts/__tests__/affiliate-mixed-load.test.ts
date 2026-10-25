import { describe, expect, it } from 'vitest';
import { runAffiliateMixedLoad, validateRun } from '../lib/affiliate-mixed-load.mjs';

const origin = 'http://127.0.0.1:54321';
const allowlistedOrigins = [origin];
type AdapterObservation = { syntheticSubjectId: string; syntheticOrderId: string;
  syntheticOnly: boolean; mockExternalProviders: boolean; allowExternalEffects: boolean };

describe('affiliate mixed-load safety and accounting', () => {
  it('requires an explicitly allowlisted isolated origin and rejects production hosts', () => {
    expect(() => validateRun({ origin: 'https://mylawatan.my', allowlistedOrigins })).toThrow('non_isolated_host_refused');
    expect(() => validateRun({ origin, allowlistedOrigins: [] })).toThrow('origin_not_allowlisted');
    expect(() => validateRun({ origin: `${origin}/api/write`, allowlistedOrigins })).toThrow('origin_only_required');
  });

  it('rejects caps above the hard maximum and requires an injected synthetic adapter', async () => {
    expect(() => validateRun({ origin, allowlistedOrigins, caps: { requests: 1001 } })).toThrow('invalid_cap_requests');
    await expect(runAffiliateMixedLoad({ origin, allowlistedOrigins })).rejects.toThrow('synthetic_adapter_required');
    await expect(runAffiliateMixedLoad({ origin, allowlistedOrigins, adapter: async () => ({}),
      phases: [{ name: 'too-fast', rps: 21, durationMs: 1000 }] })).rejects.toThrow('phase_exceeds_caps');
    await expect(runAffiliateMixedLoad({ origin, allowlistedOrigins, adapter: async () => ({}),
      phases: Array.from({ length: 65 }, (_, index) => ({ name: `phase-${index}`, rps: 1, durationMs: 1000 })) }))
      .rejects.toThrow('phase_count_exceeds_caps');
  });

  it('keeps throttles, failures, business completion, concurrency, and resource samples distinct', async () => {
    const seen: AdapterObservation[] = [];
    const result = await runAffiliateMixedLoad({ origin, allowlistedOrigins,
      caps: { requests: 3, concurrency: 2, rps: 20, phaseMs: 2000, deadlineMs: 3000, timeoutMs: 1000 },
      phases: [{ name: 'synthetic', rps: 20, durationMs: 1000 }],
      adapter: async input => {
        seen.push(input);
        if (seen.length === 1) return { status: 429, kind: 'throttled' };
        if (seen.length === 2) return { status: 503, kind: 'failed' };
        return { status: 200, businessCompleted: true, cpuMs: 12, dbWaitMs: 3, lockWaitMs: 1, oldestQueueSeconds: 9 };
      } });
    const stage = result.stages[0];
    expect(result.issued).toBe(3);
    expect(stage.status).toEqual({ ok: 1, throttled: 1, failed: 1, businessCompleted: 1 });
    expect(stage.peakInFlight).toBeLessThanOrEqual(2);
    expect(stage.resources.cpuMs).toEqual({ sampleCount: 1, average: 12, max: 12 });
    expect(stage.resources.appRssBytes).toBeNull();
    expect(new Set(seen.map(item => item.syntheticSubjectId)).size).toBeGreaterThan(0);
    expect(seen.every(item => item.syntheticOrderId.startsWith('synthetic-order-'))).toBe(true);
    expect(seen.every(item => item.syntheticOnly && item.mockExternalProviders && !item.allowExternalEffects)).toBe(true);
    expect(result.scope).toContain('no real payment');
  });

  it('hard-stops an adapter that ignores its abort signal and reports unavailable resource data as null', async () => {
    const result = await runAffiliateMixedLoad({ origin, allowlistedOrigins,
      caps: { requests: 1, concurrency: 1, rps: 2, phaseMs: 1000, deadlineMs: 2000, timeoutMs: 20 },
      phases: [{ name: 'hung-adapter', rps: 2, durationMs: 500 }],
      adapter: async () => new Promise(() => {}) });
    expect(result.stages[0].status.failed).toBe(1);
    expect(result.stages[0].resources.cpuMs).toBeNull();
    expect(result.stages[0].resources.activeConnections).toBeNull();
    expect(result.stages[0].latencyMs.sampleCount).toBe(1);
  });

  it('runs explicit hotspot and independent-subject phases with synthetic identities', async () => {
    const actors: string[] = [];
    const result = await runAffiliateMixedLoad({ origin, allowlistedOrigins,
      caps: { requests: 4, concurrency: 2, rps: 10, phaseMs: 1000, deadlineMs: 2000 },
      phases: [
        { name: 'hotspot', rps: 10, durationMs: 200, actorMode: 'hotspot' },
        { name: 'independent', rps: 10, durationMs: 200, actorMode: 'independent' },
      ],
      adapter: async input => { actors.push(input.syntheticSubjectId); return { status: 200, businessCompleted: true }; } });
    expect(result.stages.map(stage => stage.actorMode)).toEqual(['hotspot', 'independent']);
    expect(actors.slice(0, 2)).toEqual(['synthetic-hotspot-owner', 'synthetic-hotspot-owner']);
    expect(new Set(actors.slice(2)).size).toBe(2);
  });

  it('stops the outer phase loop once the global request budget is exhausted', async () => {
    const result = await runAffiliateMixedLoad({ origin, allowlistedOrigins,
      caps: { requests: 1, concurrency: 1, rps: 1, phaseMs: 1000, deadlineMs: 2000, timeoutMs: 500 },
      phases: [
        { name: 'first', rps: 1, durationMs: 1000 },
        { name: 'must-not-run', rps: 1, durationMs: 1000 },
      ], adapter: async () => ({ status: 200 }) });
    expect(result.issued).toBe(1);
    expect(result.stages.map(stage => stage.name)).toEqual(['first']);
  });

  it('bounds a hanging in-flight adapter by the remaining global deadline', async () => {
    const result = await runAffiliateMixedLoad({ origin, allowlistedOrigins,
      caps: { requests: 1, concurrency: 1, rps: 1, phaseMs: 1000, deadlineMs: 30, timeoutMs: 1000 },
      phases: [{ name: 'deadline', rps: 1, durationMs: 1000 }],
      adapter: async () => new Promise(() => {}) });
    expect(result.stages[0].status.failed).toBe(1);
    expect(result.stages[0].elapsedMs).toBeLessThan(500);
  });
});
