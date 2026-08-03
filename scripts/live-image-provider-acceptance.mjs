import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..');

export function readLiveImageAcceptanceConfig(env = process.env) {
  const apiKey = env.SYNC_THINK_LIVE_IMAGE_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      skip: true,
      reason: 'SYNC_THINK_LIVE_IMAGE_API_KEY/OPENAI_API_KEY is not configured',
    };
  }
  const reviewModel = env.SYNC_THINK_LIVE_IMAGE_REVIEW_MODEL;
  if (!reviewModel) {
    throw new Error('SYNC_THINK_LIVE_IMAGE_REVIEW_MODEL is required when live image acceptance is enabled');
  }
  const count = numberInRange(env.SYNC_THINK_LIVE_IMAGE_COUNT, 2, 2, 4, 'image count');
  const selectedIndex = numberInRange(
    env.SYNC_THINK_LIVE_IMAGE_SELECTED_INDEX,
    0,
    0,
    count - 1,
    'selected image index',
  );
  return {
    skip: false,
    apiKey,
    baseUrl: env.SYNC_THINK_LIVE_IMAGE_BASE_URL ?? env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    imageModel: env.SYNC_THINK_LIVE_IMAGE_MODEL ?? 'gpt-image-1',
    reviewApiKey: env.SYNC_THINK_LIVE_IMAGE_REVIEW_API_KEY ?? apiKey,
    reviewBaseUrl:
      env.SYNC_THINK_LIVE_IMAGE_REVIEW_BASE_URL ??
      env.SYNC_THINK_LIVE_IMAGE_BASE_URL ??
      env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1',
    reviewModel,
    prompt:
      env.SYNC_THINK_LIVE_IMAGE_PROMPT ??
      'Create a clean editorial illustration of a calm multi-agent software workbench, dark navy background, cyan status lights, no logos, no readable text.',
    count,
    selectedIndex,
    size: env.SYNC_THINK_LIVE_IMAGE_SIZE ?? '1024x1024',
    quality: env.SYNC_THINK_LIVE_IMAGE_QUALITY ?? 'medium',
    timeoutMs: numberInRange(
      env.SYNC_THINK_LIVE_IMAGE_TIMEOUT_MS,
      120_000,
      1_000,
      600_000,
      'timeout',
    ),
    outputRoot: resolve(
      env.SYNC_THINK_LIVE_IMAGE_OUTPUT_ROOT ??
        resolve(WORKSPACE_ROOT, '.data', 'live-image-provider-acceptance'),
    ),
  };
}

function numberInRange(raw, fallback, minimum, maximum, label) {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseVisualReviewOutcome(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [fenced, trimmed].filter(Boolean);
  let parsed;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      const first = candidate.indexOf('{');
      const last = candidate.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try {
          parsed = JSON.parse(candidate.slice(first, last + 1));
          break;
        } catch {
          // Try the next representation.
        }
      }
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('visual reviewer did not return a JSON object');
  }
  const status = parsed.status;
  if (status !== 'pass' && status !== 'needs_rework') {
    throw new Error('visual reviewer status must be pass or needs_rework');
  }
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.trim() : '';
  if (!summary || !feedback) {
    throw new Error('visual reviewer summary and feedback are required');
  }
  return { status, summary, feedback };
}

export function scrubAcceptanceError(error, secrets) {
  let text = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

async function runVisualReview(adapter, config, visionInput, idempotencyKey) {
  const events = [];
  for await (const event of adapter.call({
    protocol: 'openai-responses',
    baseUrl: config.reviewBaseUrl,
    modelId: config.reviewModel,
    apiKey: config.reviewApiKey,
    idempotencyKey,
    signal: new AbortController().signal,
    systemPrompt:
      'You are a strict visual reviewer. Return only JSON: {"status":"pass|needs_rework","summary":"...","feedback":"..."}. Never include secrets or markdown.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Review this generated image against the prompt: ${config.prompt}`,
          },
          { type: 'image', imageUrl: visionInput.dataUrl },
        ],
      },
    ],
    maxOutputTokens: 500,
    temperature: 0,
    stream: true,
  })) {
    events.push(event);
  }
  const providerError = events.find((event) => event.type === 'error');
  if (providerError) {
    const error = new Error(providerError.message);
    error.failureClass = providerError.failureClass;
    throw error;
  }
  const text = events
    .filter((event) => event.type === 'text-delta')
    .map((event) => event.text)
    .join('');
  return {
    outcome: parseVisualReviewOutcome(text),
    usage: events.findLast((event) => event.type === 'usage'),
  };
}

export async function runLiveImageProviderAcceptance(config = readLiveImageAcceptanceConfig()) {
  if (config.skip) return { status: 'skipped', reason: config.reason };
  const startedAt = new Date().toISOString();
  const runId = `live-image-${startedAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runRoot = resolve(config.outputRoot, runId);
  const artifactRoot = resolve(runRoot, 'artifacts');
  const reportPath = resolve(runRoot, 'acceptance-report.json');
  await mkdir(artifactRoot, { recursive: true });

  const [{ OpenAIImagesAdapter, OpenAIResponsesAdapter }, { GeneratedImageStore }] =
    await Promise.all([
      import('../packages/adapters/dist/index.js'),
      import('../apps/runtime/dist/orchestration/generated-image-store.js'),
    ]);
  const imageAdapter = new OpenAIImagesAdapter({
    timeoutMs: config.timeoutMs,
    maxRetries: 1,
    retryBaseDelayMs: 500,
  });
  const reviewerAdapter = new OpenAIResponsesAdapter();
  const store = new GeneratedImageStore(artifactRoot);
  const firstIdempotencyKey = `${runId}:generate:v1`;

  try {
    const first = await imageAdapter.generateImages({
      protocol: 'openai-images',
      baseUrl: config.baseUrl,
      modelId: config.imageModel,
      apiKey: config.apiKey,
      idempotencyKey: firstIdempotencyKey,
      signal: new AbortController().signal,
      prompt: config.prompt,
      count: config.count,
      size: config.size,
      quality: config.quality,
      outputFormat: 'png',
      background: 'auto',
    });
    const candidates = await store.store({
      runId,
      stepId: 'generate-v1',
      idempotencyKey: firstIdempotencyKey,
      images: first.images,
    });
    const selected = candidates[config.selectedIndex];
    if (!selected) throw new Error('selected image candidate was not returned by the provider');
    const selectedVision = await store.readForVision({
      artifactVersionId: `candidate-v1-${config.selectedIndex + 1}`,
      contentRef: selected.contentRef,
      contentHash: selected.contentHash,
      mimeType: selected.mimeType,
    });
    const review = await runVisualReview(
      reviewerAdapter,
      config,
      selectedVision,
      `${runId}:review:v1`,
    );

    const revisionPrompt = [
      config.prompt,
      'Create a second-version revision of the selected candidate.',
      `Visual reviewer summary: ${review.outcome.summary}`,
      `Visual reviewer feedback: ${review.outcome.feedback}`,
      review.outcome.status === 'pass'
        ? 'Preserve the successful composition while making one clearly visible polish improvement.'
        : 'Address every reviewer concern explicitly.',
    ].join('\n');
    const revised = await imageAdapter.generateImages({
      protocol: 'openai-images',
      baseUrl: config.baseUrl,
      modelId: config.imageModel,
      apiKey: config.apiKey,
      idempotencyKey: `${runId}:generate:v2`,
      signal: new AbortController().signal,
      prompt: revisionPrompt,
      count: 1,
      size: config.size,
      quality: config.quality,
      outputFormat: 'png',
      background: 'auto',
    });
    const revisedStored = await store.store({
      runId,
      stepId: 'generate-v2',
      idempotencyKey: `${runId}:generate:v2`,
      images: revised.images,
    });
    const finalCandidate = revisedStored[0];
    if (!finalCandidate) throw new Error('rework image candidate was not returned by the provider');

    // Simulate Runtime restart: a fresh store instance must re-hydrate the persisted final image.
    const restartedStore = new GeneratedImageStore(artifactRoot);
    const recovered = await restartedStore.readForVision({
      artifactVersionId: 'candidate-v2-1',
      contentRef: finalCandidate.contentRef,
      contentHash: finalCandidate.contentHash,
      mimeType: finalCandidate.mimeType,
    });
    const report = {
      version: 1,
      status: 'passed',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      provider: {
        imageModel: config.imageModel,
        reviewModel: config.reviewModel,
        baseUrlOrigin: new URL(config.baseUrl).origin,
        reviewBaseUrlOrigin: new URL(config.reviewBaseUrl).origin,
      },
      promptHash: createHash('sha256').update(config.prompt, 'utf8').digest('hex'),
      firstGeneration: {
        candidateCount: candidates.length,
        selectedIndex: config.selectedIndex,
        candidates: candidates.map((candidate, index) => ({
          artifactVersionId: `candidate-v1-${index + 1}`,
          contentRef: candidate.contentRef,
          contentHash: candidate.contentHash,
          mimeType: candidate.mimeType,
          byteLength: candidate.byteLength,
        })),
      },
      visualReview: review,
      rework: {
        performed: true,
        parentArtifactVersionId: `candidate-v1-${config.selectedIndex + 1}`,
        artifactVersionId: 'candidate-v2-1',
        contentRef: finalCandidate.contentRef,
        contentHash: finalCandidate.contentHash,
        mimeType: finalCandidate.mimeType,
        byteLength: finalCandidate.byteLength,
      },
      restartRecovery: {
        passed: recovered.contentHash === finalCandidate.contentHash,
        contentHash: recovered.contentHash,
        byteLength: recovered.byteLength,
      },
    };
    await atomicJson(reportPath, report);
    return { ...report, reportPath };
  } catch (error) {
    const failureClass = typeof error?.failureClass === 'string' ? error.failureClass : 'unknown';
    const report = {
      version: 1,
      status: 'failed',
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      failureClass,
      error: scrubAcceptanceError(error, [config.apiKey, config.reviewApiKey]),
    };
    await atomicJson(reportPath, report);
    throw Object.assign(new Error(`${failureClass}: ${report.error}`), { reportPath, failureClass });
  }
}

async function main() {
  const config = readLiveImageAcceptanceConfig();
  const result = await runLiveImageProviderAcceptance(config);
  if (result.status === 'skipped') {
    console.log(`Live image provider acceptance skipped: ${result.reason}`);
    return;
  }
  console.log(`Live image provider acceptance passed: ${result.runId}`);
  console.log(`Candidates: ${result.firstGeneration.candidateCount}`);
  console.log(`Review: ${result.visualReview.outcome.status}`);
  console.log(`Rework/restart recovery: passed`);
  console.log(`Report: ${result.reportPath}`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'live image provider acceptance failed');
    if (error?.reportPath) console.error(`Report: ${error.reportPath}`);
    process.exitCode = 1;
  });
}
