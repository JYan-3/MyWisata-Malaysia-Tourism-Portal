import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

export const MAX_LIMITS = Object.freeze({ requests: 1000, concurrency: 16, rps: 20,
  phaseMs: 120_000, deadlineMs: 300_000, timeoutMs: 10_000 });
export const MAX_PHASES = 64;

export const workload = Object.freeze([
  { name: 'browse', weight: 40 },
  { name: 'notification_poll', weight: 25 },
  { name: 'checkout_attribution', weight: 15 },
  { name: 'affiliate_clearing', weight: 8 },
  { name: 'refund', weight: 5 },
  { name: 'admin_review', weight: 7 },
]);

/** @typedef {'hotspot'|'independent'} ActorMode */
/** @typedef {{name: string, rps: number, durationMs: number, actorMode?: ActorMode}} LoadPhase */
/** @typedef {{requests?: number, concurrency?: number, rps?: number, phaseMs?: number, deadlineMs?: number, timeoutMs?: number}} LoadCaps */
/** @typedef {{origin: string, allowlistedOrigins: string[], operation: string, syntheticSubjectId: string, syntheticOrderId: string, syntheticOnly: true, mockExternalProviders: true, allowExternalEffects: false, signal: AbortSignal}} AdapterInput */
/** @typedef {{status?: number, kind?: string, businessCompleted?: boolean, cpuMs?: number, appRssBytes?: number, dbRssBytes?: number, dbWaitMs?: number, activeConnections?: number, lockWaitMs?: number, batchMs?: number, expiredLeaseCount?: number, oldestQueueSeconds?: number, externalEffects?: boolean, error?: string}} AdapterResult */
/** @typedef {(input: AdapterInput) => Promise<AdapterResult>|AdapterResult} LoadAdapter */

function isIsolatedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || host.endsWith('.localhost') || host.endsWith('.test');
}

/** @param {{origin: string, allowlistedOrigins: string[], caps?: LoadCaps}} options */
export function validateRun({ origin, allowlistedOrigins, caps = {} }) {
  if (typeof origin !== 'string') throw new Error('isolated_origin_required');
  let target;
  try { target = new URL(origin); } catch { throw new Error('invalid_origin'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password
    || target.pathname !== '/' || target.search || target.hash) throw new Error('origin_only_required');
  if (!isIsolatedHost(target.hostname)) throw new Error('non_isolated_host_refused');
  if (!Array.isArray(allowlistedOrigins) || !allowlistedOrigins.includes(target.origin)) {
    throw new Error('origin_not_allowlisted');
  }
  const limits = { ...MAX_LIMITS, ...caps };
  for (const [name, max] of Object.entries(MAX_LIMITS)) {
    if (!Number.isFinite(limits[name]) || limits[name] <= 0 || limits[name] > max) {
      throw new Error(`invalid_cap_${name}`);
    }
  }
  if (!Number.isInteger(limits.requests) || !Number.isInteger(limits.concurrency)) {
    throw new Error('integer_cap_required');
  }
  return { origin: target.origin, caps: limits };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * p) - 1];
}

function summarizeMetric(samples, key) {
  const values = samples.map(sample => sample[key]).filter(Number.isFinite);
  if (!values.length) return null;
  return { sampleCount: values.length,
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    max: Math.max(...values) };
}

/**
 * Bounded open-arrival mixed workload. The injected adapter must use synthetic
 * identities and mock external providers; this runner has no payment, email,
 * OTP, OCR, or production adapter of its own.
 */
/** @param {{origin: string, allowlistedOrigins: string[], adapter?: LoadAdapter, caps?: LoadCaps, phases?: LoadPhase[]}} options */
export async function runAffiliateMixedLoad({ origin, allowlistedOrigins, adapter,
  caps: requestedCaps = {}, phases = [{ name: 'baseline', rps: 2, durationMs: 5000 },
    { name: 'peak', rps: 10, durationMs: 10_000 }, { name: 'recovery', rps: 2, durationMs: 5000 }] }) {
  const validated = validateRun({ origin, allowlistedOrigins, caps: requestedCaps });
  if (typeof adapter !== 'function') throw new Error('synthetic_adapter_required');
  if (!Array.isArray(phases) || phases.length === 0) throw new Error('phases_required');
  if (phases.length > MAX_PHASES) throw new Error('phase_count_exceeds_caps');
  for (const phase of phases) {
    if (!phase.name || !Number.isFinite(phase.rps) || phase.rps <= 0 || phase.rps > validated.caps.rps
      || !Number.isFinite(phase.durationMs) || phase.durationMs <= 0
      || phase.durationMs > validated.caps.phaseMs
      || (phase.actorMode !== undefined && !['hotspot', 'independent'].includes(phase.actorMode))) {
      throw new Error('phase_exceeds_caps');
    }
  }

  const startedAt = new Date().toISOString();
  const deadline = performance.now() + validated.caps.deadlineMs;
  const budget = { issued: 0 };
  const stages = [];
  let peakInFlight = 0;
  let sequence = 0;
  const workloadTotal = workload.reduce((sum, entry) => sum + entry.weight, 0);
  const selectOperation = index => {
    const point = (index * 37) % workloadTotal;
    let cursor = 0;
    return workload.find(entry => (cursor += entry.weight) > point).name;
  };

  for (const phase of phases) {
    const start = performance.now();
    const planned = Math.ceil(phase.rps * phase.durationMs / 1000);
    const samples = [];
    const pending = new Set();
    let skippedAtClientCap = 0;
    let stopped = null;
    const issue = async operation => {
      const requestStarted = performance.now();
      let sample = { operation, kind: 'failed', status: null };
      const requestController = new AbortController();
      const requestTimeoutMs = Math.max(1, Math.ceil(Math.min(validated.caps.timeoutMs, deadline - requestStarted)));
      let timer;
      try {
        const timedOut = new Promise((_, reject) => {
          timer = setTimeout(() => {
            requestController.abort();
            const error = new Error('adapter_timeout');
            error.name = 'TimeoutError';
            reject(error);
          }, requestTimeoutMs);
        });
        const result = await Promise.race([adapter({ origin: validated.origin, allowlistedOrigins, operation,
          syntheticSubjectId: phase.actorMode === 'hotspot' ? 'synthetic-hotspot-owner'
            : `synthetic-subject-${(sequence % 500) + 1}`,
          syntheticOrderId: `synthetic-order-${sequence + 1}`,
          syntheticOnly: true, mockExternalProviders: true, allowExternalEffects: false,
          signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(requestTimeoutMs)]) }), timedOut]);
        sample.status = result?.status ?? 200;
        sample.kind = result?.kind === 'throttled' || sample.status === 429 ? 'throttled'
          : result?.kind === 'failed' || sample.status >= 500 ? 'failed' : 'ok';
        sample.businessCompleted = result?.businessCompleted === true;
        sample.cpuMs = Number.isFinite(result?.cpuMs) ? result.cpuMs : null;
        sample.appRssBytes = Number.isFinite(result?.appRssBytes) ? result.appRssBytes : null;
        sample.dbRssBytes = Number.isFinite(result?.dbRssBytes) ? result.dbRssBytes : null;
        sample.dbWaitMs = Number.isFinite(result?.dbWaitMs) ? result.dbWaitMs : null;
        sample.activeConnections = Number.isFinite(result?.activeConnections) ? result.activeConnections : null;
        sample.lockWaitMs = Number.isFinite(result?.lockWaitMs) ? result.lockWaitMs : null;
        sample.batchMs = Number.isFinite(result?.batchMs) ? result.batchMs : null;
        sample.expiredLeaseCount = Number.isFinite(result?.expiredLeaseCount) ? result.expiredLeaseCount : null;
        sample.oldestQueueSeconds = Number.isFinite(result?.oldestQueueSeconds) ? result.oldestQueueSeconds : null;
        if (result?.externalEffects === true) {
          sample.kind = 'failed';
          sample.error = 'adapter_violated_mock_provider_contract';
        }
        if (sample.kind === 'failed' && !sample.error) sample.error = result?.error ?? 'adapter_failed';
      } catch (error) {
        sample.kind = 'failed';
        sample.error = error?.name === 'TimeoutError' ? 'timeout' : (error?.message ?? 'adapter_failed');
      } finally {
        clearTimeout(timer);
      }
      sample.elapsedMs = performance.now() - requestStarted;
      samples.push(sample);
    };

    for (let index = 0; index < planned; index += 1) {
      const scheduled = start + index * 1000 / phase.rps;
      await sleep(Math.max(0, scheduled - performance.now()));
      if (performance.now() >= deadline || budget.issued >= validated.caps.requests) {
        stopped = 'global_budget';
        break;
      }
      if (pending.size >= validated.caps.concurrency) {
        skippedAtClientCap += 1;
        continue;
      }
      sequence += 1;
      budget.issued += 1;
      const promise = issue(selectOperation(sequence - 1));
      pending.add(promise);
      peakInFlight = Math.max(peakInFlight, pending.size);
      void promise.finally(() => pending.delete(promise));
    }
    if (!stopped && budget.issued < validated.caps.requests && performance.now() < deadline) {
      await sleep(Math.max(0, start + phase.durationMs - performance.now()));
    }
    await Promise.all(pending);
    const elapsedMs = performance.now() - start;
    stages.push({ name: phase.name, actorMode: phase.actorMode ?? 'independent', targetRps: phase.rps, planned, issued: samples.length,
      skippedAtClientCap, notIssuedAfterStop: planned - samples.length - skippedAtClientCap,
      peakInFlight, elapsedMs: Math.round(elapsedMs), observedIssueRps: Number((samples.length / Math.max(0.001, elapsedMs / 1000)).toFixed(2)),
      status: { ok: samples.filter(item => item.kind === 'ok').length,
        throttled: samples.filter(item => item.kind === 'throttled').length,
        failed: samples.filter(item => item.kind === 'failed').length,
        businessCompleted: samples.filter(item => item.kind === 'ok' && item.businessCompleted).length },
      latencyMs: { p50: percentile(samples.map(item => item.elapsedMs), 0.5),
        p95: percentile(samples.map(item => item.elapsedMs), 0.95), sampleCount: samples.length },
      resources: { cpuMs: summarizeMetric(samples, 'cpuMs'), appRssBytes: summarizeMetric(samples, 'appRssBytes'),
        dbRssBytes: summarizeMetric(samples, 'dbRssBytes'), dbWaitMs: summarizeMetric(samples, 'dbWaitMs'),
        activeConnections: summarizeMetric(samples, 'activeConnections'), lockWaitMs: summarizeMetric(samples, 'lockWaitMs'),
        batchMs: summarizeMetric(samples, 'batchMs'), expiredLeaseCount: summarizeMetric(samples, 'expiredLeaseCount'),
        oldestQueueSeconds: summarizeMetric(samples, 'oldestQueueSeconds') },
      stopReason: stopped });
    if (stopped === 'global_budget' || budget.issued >= validated.caps.requests
      || performance.now() >= deadline) break;
  }
  return { startedAt, finishedAt: new Date().toISOString(), origin: validated.origin,
    issued: budget.issued, caps: validated.caps, workload, stages,
    scope: 'Synthetic adapter only; no real payment, refund, email, OTP, OCR, or production action. Missing resource samples remain unmeasured.' };
}
