import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { loadExistingEvidencePreparation } from './kyc-local-ocr-benchmark.mjs';
import { estimateKycCapacity, simulateQueue, summarizeMeasurements } from './kyc-capacity-evaluation.mjs';

const MAX_CASES = 3;
const MAX_PADDLE_WORKERS = 2;
const DEFAULT_CASES = 1;
const MAX_PADDLE_MS = 120_000;
const PADDLE_RUNTIME = '/tmp/mywisata-paddle-ocr-runtime';
const PADDLE_PYTHON = path.join(PADDLE_RUNTIME, 'bin', 'python');
const PADDLE_MODELS = path.join(PADDLE_RUNTIME, 'models', 'official_models');

export function parseOptions(argv) {
  const options = { cases: DEFAULT_CASES, runPaddle: false, paddleWorkers: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--cases') {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CASES) throw new Error('cases_out_of_local_safety_range');
      options.cases = value;
      index += 1;
    } else if (argv[index] === '--paddle') {
      options.runPaddle = true;
    } else if (argv[index] === '--paddle-workers') {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PADDLE_WORKERS) throw new Error('paddle_worker_count_outside_local_safety_range');
      options.paddleWorkers = value;
      index += 1;
    } else {
      throw new Error('unsupported_option');
    }
  }
  if (!options.runPaddle && options.paddleWorkers !== 1) throw new Error('paddle_workers_require_paddle_mode');
  return options;
}

function syntheticFixture(label, side, width = 1800, height = 1120) {
  // Fictional text and layout only; intentionally unlike any government ID.
  const title = `SYNTHETIC CAPACITY FIXTURE ${side.toUpperCase()}`;
  const scale = width / 1800;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8fafc"/><rect x="${40 * scale}" y="${40 * scale}" width="${width - 80 * scale}" height="${height - 80 * scale}" fill="none" stroke="#475569" stroke-width="${8 * scale}"/><text x="${100 * scale}" y="${240 * scale}" font-family="Arial,sans-serif" font-size="${64 * scale}" fill="#111827">${title}</text><text x="${100 * scale}" y="${480 * scale}" font-family="Arial,sans-serif" font-size="${56 * scale}" fill="#111827">${label}</text><text x="${100 * scale}" y="${680 * scale}" font-family="Arial,sans-serif" font-size="${46 * scale}" fill="#111827">TEST ONLY - NOT AN IDENTITY DOCUMENT</text></svg>`);
}

function syntheticNoise(width, height, seed) {
  let state = seed >>> 0;
  const data = Buffer.alloc(width * height * 3);
  for (let index = 0; index < data.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[index] = state & 0xff;
  }
  return data;
}

async function syntheticNearLimitJpeg(seed) {
  const width = 2600;
  const height = 2000;
  const noise = syntheticNoise(width, height, seed);
  let bestBelowLimit = null;
  for (const quality of [95, 90, 85, 80]) {
    const encoded = await sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
    if (encoded.length < 5 * 1024 * 1024 && (!bestBelowLimit || encoded.length > bestBelowLimit.length)) bestBelowLimit = encoded;
    if (encoded.length >= 3.5 * 1024 * 1024 && encoded.length < 5 * 1024 * 1024) return encoded;
  }
  if (!bestBelowLimit) throw new Error('synthetic_near_limit_fixture_exceeds_upload_limit');
  return bestBelowLimit;
}

async function measureImageAndPayload(cases) {
  const prepare = await loadExistingEvidencePreparation();
  const standardFront = await sharp(syntheticFixture('SAMPLE FRONT', 'front')).png().toBuffer();
  const standardBack = await sharp(syntheticFixture('SAMPLE BACK', 'back')).png().toBuffer();
  const highPixelFront = await sharp(syntheticFixture('SAMPLE FRONT', 'front', 5000, 4000)).png().toBuffer();
  const highPixelBack = await sharp(syntheticFixture('SAMPLE BACK', 'back', 5000, 4000)).png().toBuffer();
  const noisyFront = await syntheticNearLimitJpeg(17);
  const noisyBack = await syntheticNearLimitJpeg(29);
  const variants = [
    { name: 'small_compressed_rotated', front: await sharp(standardFront).resize(900, 560).rotate(180).jpeg({ quality: 45 }).toBuffer(), back: await sharp(standardBack).resize(900, 560).rotate(180).jpeg({ quality: 45 }).toBuffer(), mime: 'image/jpeg', pixels: [900, 560] },
    { name: 'compact_file_high_pixel_count', front: highPixelFront, back: highPixelBack, mime: 'image/png', pixels: [5000, 4000] },
    { name: 'high_entropy_near_upload_size', front: noisyFront, back: noisyBack, mime: 'image/jpeg', pixels: [2600, 2000] },
  ];
  const observations = [];
  let invalidImageRejected = false;
  try { await prepare(Buffer.from('synthetic damaged image'), 'image/png'); } catch { invalidImageRejected = true; }
  for (const variant of variants) {
      if (variant.front.length > 5 * 1024 * 1024 || variant.back.length > 5 * 1024 * 1024) {
        throw new Error('synthetic_fixture_exceeds_existing_upload_limit');
      }
      const prepareMs = [];
      const payloadMs = [];
      const storedBytes = [];
      for (let index = 0; index < cases; index += 1) {
        const started = performance.now();
        const prepared = await Promise.all([
          prepare(variant.front, variant.mime),
          prepare(variant.back, variant.mime),
        ]);
        prepareMs.push(performance.now() - started);
        const payloadStarted = performance.now();
        const body = JSON.stringify({
          front: { mimeType: 'image/jpeg', data: prepared[0].stored.toString('base64') },
          back: { mimeType: 'image/jpeg', data: prepared[1].stored.toString('base64') },
        });
        payloadMs.push(performance.now() - payloadStarted);
        storedBytes.push({ images: prepared.map((image) => image.stored.length), serializedBodyBytes: Buffer.byteLength(body) });
      }
      observations.push({
        variant: variant.name,
        imagePixels: variant.pixels,
        sourceImageBytes: summarizeMeasurements([variant.front.length, variant.back.length], 'Bytes'),
        preparePair: summarizeMeasurements(prepareMs),
        jsonBase64Serialization: summarizeMeasurements(payloadMs),
        storedImageBytes: summarizeMeasurements(storedBytes.flatMap((item) => item.images), 'Bytes'),
        serializedBodyBytes: summarizeMeasurements(storedBytes.map((item) => item.serializedBodyBytes), 'Bytes'),
      });
  }
  return {
    stage: 'existing_sharp_evidence_preparation_on_synthetic_images',
    syntheticPairs: cases,
    independentAccuracySamples: false,
    variants: observations,
    corruptImageRejected: invalidImageRejected,
    nodeRssAtReportMiB: Math.round(process.memoryUsage().rss / 1_048_576),
    networkOrStorageCalls: 0,
    sourceOrOcrTextPersisted: false,
  };
}

function simulateScenarios() {
  const stableArrivals = Array.from({ length: 12 }, (_, index) => index * 1000);
  const burstArrivals = Array.from({ length: 12 }, () => 0);
  const recoveryArrivals = [0, 0, 0, 10_000, 10_000, 10_000];
  const service = 1500;
  return {
    stable: simulateQueue({ arrivalTimesMs: stableArrivals, serviceTimesMs: stableArrivals.map(() => service), concurrency: 2 }),
    burst: simulateQueue({ arrivalTimesMs: burstArrivals, serviceTimesMs: burstArrivals.map(() => service), concurrency: 2 }),
    extraRetryWork: simulateQueue({
      arrivalTimesMs: [...stableArrivals.slice(0, 6), ...stableArrivals.slice(0, 6).map((time) => time + 10_000)],
      serviceTimesMs: Array.from({ length: 12 }, () => service),
      concurrency: 2,
    }),
    arrivalsAfterPause: simulateQueue({ arrivalTimesMs: recoveryArrivals, serviceTimesMs: recoveryArrivals.map(() => service), concurrency: 2 }),
    caveat: 'Scenario service times, concurrency, retry timing, and pause duration are illustrative assumptions; no OCR failure rate or recovery behavior is inferred.',
  };
}

function runPaddleWorker(cases) {
  return new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL('./kyc-capacity-ocr-worker.py', import.meta.url));
    const child = spawn(PADDLE_PYTHON, ['-I', workerPath, PADDLE_MODELS, String(cases)], {
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: os.tmpdir(), LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 1000);
      force.unref();
      finish(new Error('local_paddle_measurement_timeout'));
    }, MAX_PADDLE_MS);
    timer.unref();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 16_384) child.kill('SIGKILL');
    });
    child.once('error', () => finish(new Error('local_paddle_worker_unavailable')));
    child.once('close', (code) => {
      if (code !== 0) return finish(new Error('local_paddle_measurement_failed'));
      const line = stdout.split('\n').find((value) => value.startsWith('KYC_CAPACITY_RESULT '));
      if (!line) return finish(new Error('local_paddle_result_missing'));
      try {
        finish(null, JSON.parse(line.slice('KYC_CAPACITY_RESULT '.length)));
      } catch {
        finish(new Error('local_paddle_result_invalid'));
      }
    });
  });
}

async function runPaddleWorkers(cases, workerCount) {
  const started = performance.now();
  const workers = await Promise.all(Array.from({ length: workerCount }, () => runPaddleWorker(cases)));
  return {
    mode: workerCount === 1 ? 'one_local_worker_sequential_synthetic_only' : 'bounded_parallel_local_workers_synthetic_only',
    workerCount,
    wallMs: Math.round(performance.now() - started),
    totalInferenceCpuSeconds: Math.round(workers.reduce((total, worker) => total + worker.inferenceCpuSeconds, 0) * 1000) / 1000,
    workerPeakRssMiBSumUpperBound: workers.reduce((total, worker) => total + worker.workerPeakRssMiB, 0),
    workerPeakRssCaveat: 'Sum of each child process high-water mark; conservative upper bound, not simultaneous aggregate RSS.',
    workers,
  };
}

export async function runKycCapacityEvaluation(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  const imagePipeline = await measureImageAndPayload(options.cases);
  const cpu = process.cpuUsage(cpuStarted);
  const report = {
    evaluation: 'local_synthetic_kyc_capacity',
    generatedAt: new Date().toISOString(),
    machine: { platform: `${os.platform()}-${os.arch()}`, cpu: os.cpus()[0]?.model ?? null, memoryMiB: Math.round(os.totalmem() / 1_048_576), node: process.version },
    safety: { syntheticOnly: true, networkAccess: 'not_used; optional Python worker applies a socket guard, not an OS firewall', databaseCalls: 0, storageCalls: 0, rawOcrTextReported: false, productionCapacityCertified: false },
    simulation: simulateScenarios(),
    illustrativeScheduleArithmetic: {
      assumptions: { dailyEvidenceVersions: 10_000, averageAttemptsPerVersion: 1, batchSize: 20, intervalMinutes: 5 },
      result: estimateKycCapacity({ dailyEvidenceVersions: 10_000, averageAttemptsPerVersion: 1, batchSize: 20, intervalMinutes: 5 }),
      meaning: 'Illustration only; retry average, batch size, and schedule are unapproved assumptions, not a production capacity conclusion.',
    },
    imagePipeline,
    process: { elapsedMs: Math.round(performance.now() - started), nodeParentCpuSecondsExcludingPaddle: Math.round((cpu.user + cpu.system) / 1000) / 1000, nodeParentRssAtReportMiB: Math.round(process.memoryUsage().rss / 1_048_576) },
    limitations: ['Synthetic repeated workloads do not estimate real-photo accuracy.', 'Local machine results do not certify the hosting plan.', 'OCR and database persistence are unmeasured unless the optional local Paddle mode is run; database writes are never performed.'],
  };

  if (options.runPaddle) {
    const modelMarker = path.join(PADDLE_MODELS, 'PP-OCRv5_mobile_det', 'inference.json');
    try {
      await fs.access(modelMarker);
    } catch {
      throw new Error('preinstalled_local_paddle_models_unavailable');
    }
    report.localPaddle = await runPaddleWorkers(options.cases, options.paddleWorkers);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runKycCapacityEvaluation(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch {
    process.stderr.write('KYC capacity evaluation stopped; see the local error category without attaching identity files or credentials.\n');
    process.exitCode = 1;
  }
}
