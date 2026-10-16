import { describe, expect, it } from 'vitest';
import {
  estimateKycCapacity,
  scheduledAttemptCapacity,
  requiredAttempts,
  classifyAcknowledgement,
  simulateQueue,
  summarizeMeasurements,
} from '../lib/kyc-capacity-evaluation.mjs';
import { parseOptions } from '../lib/kyc-capacity-evaluation-runner.mjs';

describe('KYC capacity evaluation', () => {
  it('matches the planned scheduling, retry, and acknowledged-result examples', () => {
    expect(scheduledAttemptCapacity({ batch: 20, intervalSeconds: 300, windowSeconds: 86_400 })).toBe(5_760);
    expect(requiredAttempts({ finalizedRevisions: 10_000, attemptsPerRevision: 1.5 })).toBe(15_000);
    expect(classifyAcknowledgement({ applied: true, ocrStatus: 'unavailable' })).toEqual({ acknowledged: 1, ocrSucceeded: 0, unavailable: 1 });
    expect(classifyAcknowledgement({ applied: false, ocrStatus: 'matched' })).toEqual({ acknowledged: 0, ocrSucceeded: 0, unavailable: 0 });
    expect(() => classifyAcknowledgement({ applied: true, ocrStatus: 'future-status' })).toThrow('unsupported_ocr_status');
  });

  it('separates unique evidence versions from retry attempts and scheduler capacity', () => {
    expect(estimateKycCapacity({
      dailyEvidenceVersions: 10_000,
      averageAttemptsPerVersion: 1.2,
      batchSize: 20,
      intervalMinutes: 5,
    })).toEqual({
      uniqueEvidenceVersions: 10_000,
      estimatedMachineAttempts: 12_000,
      scheduledAttemptCeiling: 5_760,
      scheduledCapacityShortfall: 6_240,
    });
  });

  it('does not claim scheduler capacity when an input is unknown', () => {
    expect(estimateKycCapacity({
      dailyEvidenceVersions: 10_000,
      averageAttemptsPerVersion: null,
      batchSize: 20,
      intervalMinutes: 5,
    })).toMatchObject({
      estimatedMachineAttempts: null,
      scheduledAttemptCeiling: 5_760,
      scheduledCapacityShortfall: null,
    });
  });

  it('rejects fractional or overflowing workload counts', () => {
    expect(() => estimateKycCapacity({ dailyEvidenceVersions: 1.5, averageAttemptsPerVersion: 1, batchSize: 1, intervalMinutes: 1 })).toThrow();
    expect(() => estimateKycCapacity({ dailyEvidenceVersions: Number.MAX_SAFE_INTEGER, averageAttemptsPerVersion: 2, batchSize: 1, intervalMinutes: 1 })).toThrow();
  });

  it('rejects arbitrary file, URL, and unbounded runner arguments', () => {
    expect(() => parseOptions(['--image', '/private/id.jpg'])).toThrow();
    expect(() => parseOptions(['--url', 'https://example.com'])).toThrow();
    expect(() => parseOptions(['--cases', '1000000'])).toThrow();
    expect(parseOptions(['--cases', '1'])).toEqual({ cases: 1, runPaddle: false, paddleWorkers: 1 });
    expect(parseOptions(['--paddle', '--paddle-workers', '2'])).toEqual({ cases: 1, runPaddle: true, paddleWorkers: 2 });
    expect(() => parseOptions(['--paddle-workers', '2'])).toThrow('paddle_workers_require_paddle_mode');
    expect(() => parseOptions(['--paddle', '--paddle-workers', '3'])).toThrow('paddle_worker_count_outside_local_safety_range');
  });

  it('distinguishes queued demand from measured engine throughput', () => {
    const result = simulateQueue({
      arrivalTimesMs: [0, 0, 0, 100],
      serviceTimesMs: [100, 100, 100, 100],
      concurrency: 2,
    });

    expect(result).toEqual({
      simulatedTasks: 4,
      simulatedTasksDrained: 4,
      meanQueueWaitMs: 25,
      maxQueueWaitMs: 100,
      lastCompletionMs: 200,
      isSimulation: true,
    });
  });

  it('shows retry amplification as extra work, not extra unique cases', () => {
    const firstRun = simulateQueue({ arrivalTimesMs: [0, 0], serviceTimesMs: [100, 100], concurrency: 1 });
    const retriedRun = simulateQueue({ arrivalTimesMs: [0, 0, 250], serviceTimesMs: [100, 100, 100], concurrency: 1 });

    expect(firstRun.simulatedTasks).toBe(2);
    expect(retriedRun.simulatedTasks).toBe(3);
    expect(retriedRun.lastCompletionMs).toBe(350);
    expect(retriedRun.isSimulation).toBe(true);
    expect(() => simulateQueue({ arrivalTimesMs: [Number.MAX_SAFE_INTEGER], serviceTimesMs: [1], concurrency: 1 })).toThrow();
  });

  it('returns a low-sensitivity distribution without preserving input values', () => {
    expect(summarizeMeasurements([10, 20, 30, 40])).toEqual({
      samples: 4,
      meanMs: 25,
      medianMs: 25,
      p95Ms: 40,
      maxMs: 40,
    });
    expect(summarizeMeasurements([])).toEqual({
      samples: 0,
      meanMs: null,
      medianMs: null,
      p95Ms: null,
      maxMs: null,
    });
    expect(summarizeMeasurements([100, 200], 'Bytes')).toMatchObject({ meanBytes: 150, maxBytes: 200 });
  });
});
