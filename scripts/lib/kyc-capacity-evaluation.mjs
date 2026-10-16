/** Capacity arithmetic and deterministic queue simulation for synthetic KYC work. */

function finiteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name}_must_be_finite_non_negative`);
  return value;
}

function finitePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name}_must_be_finite_positive`);
  return value;
}

function safeInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${name}_must_be_a_safe_integer`);
  return value;
}

export function scheduledAttemptCapacity({ batch, intervalSeconds, windowSeconds }) {
  safeInteger(batch, 'batch', { min: 1 });
  safeInteger(intervalSeconds, 'interval_seconds', { min: 1 });
  safeInteger(windowSeconds, 'window_seconds', { min: 1 });
  const result = Math.floor(windowSeconds / intervalSeconds) * batch;
  if (!Number.isSafeInteger(result)) throw new RangeError('scheduled_attempt_capacity_exceeds_safe_integer_range');
  return result;
}

export function requiredAttempts({ finalizedRevisions, attemptsPerRevision }) {
  safeInteger(finalizedRevisions, 'finalized_revisions');
  finitePositive(attemptsPerRevision, 'attempts_per_revision');
  const result = Math.ceil(finalizedRevisions * attemptsPerRevision);
  if (!Number.isSafeInteger(result)) throw new RangeError('required_attempts_exceed_safe_integer_range');
  return result;
}

export function classifyAcknowledgement({ applied, ocrStatus }) {
  if (typeof applied !== 'boolean' || typeof ocrStatus !== 'string') throw new TypeError('invalid_acknowledgement_input');
  if (!['matched', 'mismatch', 'unreadable', 'unavailable'].includes(ocrStatus)) {
    throw new TypeError('unsupported_ocr_status');
  }
  return {
    acknowledged: applied ? 1 : 0,
    ocrSucceeded: applied && ocrStatus === 'matched' ? 1 : 0,
    unavailable: applied && ocrStatus === 'unavailable' ? 1 : 0,
  };
}

export function estimateKycCapacity({
  dailyEvidenceVersions,
  averageAttemptsPerVersion,
  batchSize,
  intervalMinutes,
}) {
  safeInteger(dailyEvidenceVersions, 'daily_evidence_versions');
  if (averageAttemptsPerVersion !== null) finitePositive(averageAttemptsPerVersion, 'average_attempts_per_version');
  safeInteger(batchSize, 'batch_size', { min: 1 });
  safeInteger(intervalMinutes, 'interval_minutes', { min: 1 });

  const scheduledAttemptCeiling = scheduledAttemptCapacity({ batch: batchSize, intervalSeconds: intervalMinutes * 60, windowSeconds: 86_400 });
  const estimatedMachineAttempts = averageAttemptsPerVersion === null
    ? null
    : requiredAttempts({ finalizedRevisions: dailyEvidenceVersions, attemptsPerRevision: averageAttemptsPerVersion });
  if (estimatedMachineAttempts !== null && !Number.isSafeInteger(estimatedMachineAttempts)) {
    throw new RangeError('estimated_machine_attempts_exceed_safe_integer_range');
  }

  return {
    uniqueEvidenceVersions: dailyEvidenceVersions,
    estimatedMachineAttempts,
    scheduledAttemptCeiling,
    scheduledCapacityShortfall: estimatedMachineAttempts === null
      ? null
      : Math.max(0, estimatedMachineAttempts - scheduledAttemptCeiling),
  };
}

/**
 * Deterministic simulation only. Service times are caller-supplied assumptions,
 * not OCR observations; this function never invokes an OCR engine.
 */
export function simulateQueue({ arrivalTimesMs, serviceTimesMs, concurrency }) {
  if (!Array.isArray(arrivalTimesMs) || !Array.isArray(serviceTimesMs) || arrivalTimesMs.length !== serviceTimesMs.length || arrivalTimesMs.length > 10_000) {
    throw new TypeError('arrival_and_service_arrays_must_have_same_length');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new RangeError('concurrency_must_be_between_1_and_64');
  }

  const jobs = arrivalTimesMs.map((arrival, index) => ({
    arrival: safeInteger(arrival, 'arrival_time'),
    service: safeInteger(serviceTimesMs[index], 'service_time', { min: 1 }),
    index,
  })).sort((left, right) => left.arrival - right.arrival || left.index - right.index);

  const workerAvailableAt = Array.from({ length: concurrency }, () => 0);
  const waits = [];
  let lastCompletionMs = 0;
  for (const job of jobs) {
    let workerIndex = 0;
    for (let index = 1; index < workerAvailableAt.length; index += 1) {
      if (workerAvailableAt[index] < workerAvailableAt[workerIndex]) workerIndex = index;
    }
    const start = Math.max(job.arrival, workerAvailableAt[workerIndex]);
    const completion = start + job.service;
    safeInteger(completion, 'simulated_completion_time');
    waits.push(start - job.arrival);
    workerAvailableAt[workerIndex] = completion;
    lastCompletionMs = Math.max(lastCompletionMs, completion);
  }

  const meanQueueWaitMs = waits.length
    ? Math.round(waits.reduce((mean, wait, index) => mean + ((wait - mean) / (index + 1)), 0))
    : null;
  return {
    simulatedTasks: jobs.length,
    simulatedTasksDrained: jobs.length,
    meanQueueWaitMs,
    maxQueueWaitMs: waits.length ? Math.max(...waits) : null,
    lastCompletionMs: jobs.length ? lastCompletionMs : null,
    isSimulation: true,
  };
}

export function summarizeMeasurements(values, unit = 'Ms') {
  if (!Array.isArray(values)) throw new TypeError('measurements_must_be_an_array');
  if (!['Ms', 'Bytes'].includes(unit)) throw new TypeError('unsupported_measurement_unit');
  const sorted = values.map((value) => finiteNonNegative(value, 'measurement')).sort((a, b) => a - b);
  const fields = (mean, median, p95, max) => ({
    samples: sorted.length,
    [`mean${unit}`]: mean,
    [`median${unit}`]: median,
    [`p95${unit}`]: p95,
    [`max${unit}`]: max,
  });
  if (!sorted.length) return fields(null, null, null, null);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return fields(
    Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    medianMs,
    sorted[p95Index],
    sorted.at(-1),
  );
}
