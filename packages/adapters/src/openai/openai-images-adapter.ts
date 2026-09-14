import type {
  AdapterEvent,
  FailureClass,
  ProviderAdapter,
  ProviderCallRequest,
  ProviderGeneratedImage,
  ProviderImageGenerationRequest,
  ProviderImageGenerationResult,
} from '../types.js';
import {
  IMAGE_GENERATION_QUALITIES,
  IMAGE_GENERATION_SIZES,
  type ImageGenerationQuality,
  type ImageGenerationSize,
} from '@sync-think/shared';
import {
  discoverOpenAICompatibleModels,
  joinModelsUrl,
  scrubSecrets,
  type DiscoverOpenAICompatibleModelsOptions,
} from './discover-models.js';

const MAX_IMAGES = 4;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const HTTP_ERROR_BODY_CHARS = 4_000;
const INVALID_JSON_PREVIEW_CHARS = 240;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface OpenAIImagesAdapterOptions {
  fetchImpl?: DiscoverOpenAICompatibleModelsOptions['fetchImpl'];
  /**
   * Local wall-clock limit for one generation call. `null` means "no host
   * timer": the request is bounded only by the provider, so long image or
   * upscale jobs are never killed locally. Omit to keep the 60s default used
   * by short probes (settings-page connectivity checks).
   */
  timeoutMs?: number | null;
  /** Number of additional attempts for transient, timeout, and rate-limit failures. */
  maxRetries?: number;
  /** Base delay for exponential retry backoff. Set to 0 in deterministic fixtures. */
  retryBaseDelayMs?: number;
}

const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 60_000;

/**
 * A local host timer only exists to stop a hung probe. Chat image generation is
 * a long job (upscaling can take minutes), so callers pass `null` and rely on
 * the user cancelling the run instead of a wall-clock guess.
 */
function resolveLocalTimeoutMs(
  requestTimeout: number | null | undefined,
  optionTimeout: number | null | undefined,
): number | null {
  if (requestTimeout !== undefined) return requestTimeout;
  if (optionTimeout !== undefined) return optionTimeout;
  return DEFAULT_IMAGE_GENERATION_TIMEOUT_MS;
}

export class ProviderImageGenerationError extends Error {
  readonly failureClass: FailureClass;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, failureClass: FailureClass, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderImageGenerationError';
    this.failureClass = failureClass;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** OpenAI-compatible Images adapter using durable base64 payloads only. */
export class OpenAIImagesAdapter implements ProviderAdapter {
  readonly protocol = 'openai-images' as const;

  constructor(private readonly opts: OpenAIImagesAdapterOptions = {}) {}

  async discoverModels(apiKey: string, baseUrl: string): Promise<string[]> {
    return discoverOpenAICompatibleModels({
      apiKey,
      baseUrl,
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs ?? undefined,
    });
  }

  async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield {
      type: 'error',
      failureClass: 'protocol',
      message: 'OpenAI Images requires the typed generateImages entry point',
    };
  }

  async generateImages(
    request: ProviderImageGenerationRequest,
  ): Promise<ProviderImageGenerationResult> {
    validateRequest(request);
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const timeoutController = new AbortController();
    const timeoutMs = resolveLocalTimeoutMs(request.timeoutMs, this.opts.timeoutMs);
    const maxRetries = normalizeRetryCount(this.opts.maxRetries);
    const retryBaseDelayMs = normalizeRetryDelay(this.opts.retryBaseDelayMs);
    const timer = timeoutMs === null ? null : setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutController.signal]);
    const url = joinImagesGenerationUrl(request.baseUrl);
    const body = {
      model: request.modelId,
      prompt: request.prompt,
      n: request.count ?? 1,
      response_format: 'b64_json',
      ...(request.size ? { size: request.size } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
      ...(request.background ? { background: request.background } : {}),
    };

    try {
      for (let retryIndex = 0; ; retryIndex += 1) {
        try {
          const response = await fetchImpl(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${request.apiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': request.idempotencyKey,
            },
            body: JSON.stringify(body),
            signal,
          });
          if (!response.ok) {
            const detail = scrubSecrets(await boundedResponseText(response), [request.apiKey]);
            throw new ProviderImageGenerationError(
              `Image generation failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
              failureClassForStatus(response.status),
              response.status,
              parseRetryAfterMs(response.headers.get('retry-after')),
            );
          }
          const payload = await parseJsonResponse(response, request.apiKey);
          return { images: parseImages(payload, request.apiKey) };
        } catch (error) {
          const normalized = normalizeRequestError(error, timeoutController, request);
          if (
            !isRetryableImageFailure(normalized.failureClass) ||
            retryIndex >= maxRetries ||
            timeoutController.signal.aborted ||
            request.signal.aborted
          ) {
            throw normalized;
          }
          await waitForRetry(
            normalized.retryAfterMs ?? retryDelayMs(retryBaseDelayMs, retryIndex),
            signal,
          );
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function joinImagesGenerationUrl(baseUrl: string): string {
  const modelsUrl = joinModelsUrl(baseUrl);
  const root = modelsUrl.replace(/\/models$/i, '');
  if (/\/images\/generations$/i.test(root)) return root;
  if (/\/images$/i.test(root)) return `${root}/generations`;
  return `${root}/images/generations`;
}

function validateRequest(request: ProviderImageGenerationRequest): void {
  if (request.protocol !== 'openai-images') {
    throw new ProviderImageGenerationError('Image generation protocol is invalid', 'protocol');
  }
  if (!request.modelId.trim() || request.modelId.length > 512) {
    throw new ProviderImageGenerationError('Image generation model is invalid', 'protocol');
  }
  const promptBytes = Buffer.byteLength(request.prompt, 'utf8');
  if (!request.prompt.trim() || promptBytes > MAX_PROMPT_BYTES) {
    throw new ProviderImageGenerationError('Image generation prompt is invalid', 'acceptance');
  }
  const count = request.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_IMAGES) {
    throw new ProviderImageGenerationError(
      'Image generation count must be between 1 and 4',
      'acceptance',
    );
  }
  if (
    request.size !== undefined &&
    !IMAGE_GENERATION_SIZES.includes(request.size as ImageGenerationSize)
  ) {
    throw new ProviderImageGenerationError('Image generation size is invalid', 'acceptance');
  }
  if (
    request.quality !== undefined &&
    !IMAGE_GENERATION_QUALITIES.includes(request.quality as ImageGenerationQuality)
  ) {
    throw new ProviderImageGenerationError('Image generation quality is invalid', 'acceptance');
  }
}

async function parseJsonResponse(response: Response, apiKey: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderImageGenerationError(
      `Image generation returned invalid JSON: ${scrubSecrets(
        previewResponseText(text, INVALID_JSON_PREVIEW_CHARS),
        [apiKey],
      )}`,
      'protocol',
      response.status,
    );
  }
}

function parseImages(payload: unknown, apiKey: string): ProviderGeneratedImage[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as { data?: unknown }).data)
  ) {
    throw new ProviderImageGenerationError(
      'Image generation response has no image data',
      'protocol',
    );
  }
  const data = (payload as { data: unknown[] }).data;
  if (data.length < 1 || data.length > MAX_IMAGES) {
    throw new ProviderImageGenerationError(
      'Image generation response image count is invalid',
      'protocol',
    );
  }
  return data.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new ProviderImageGenerationError(
        `Image generation item ${index} is invalid`,
        'protocol',
      );
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.b64_json !== 'string') {
      if (typeof record.url === 'string') {
        throw new ProviderImageGenerationError(
          'Image generation returned only a remote URL; durable base64 output is required',
          'protocol',
        );
      }
      throw new ProviderImageGenerationError(
        `Image generation item ${index} has no base64 data`,
        'protocol',
      );
    }
    const compact = record.b64_json.replace(/\s/g, '');
    if (!compact || !BASE64_RE.test(compact)) {
      throw new ProviderImageGenerationError(
        `Image generation item ${index} has invalid base64 data`,
        'protocol',
      );
    }
    const bytes = Buffer.from(compact, 'base64');
    if (
      bytes.length < 1 ||
      bytes.length > MAX_IMAGE_BYTES ||
      bytes.toString('base64') !== compact
    ) {
      throw new ProviderImageGenerationError(
        `Image generation item ${index} has invalid image bytes`,
        'protocol',
      );
    }
    const mimeType = detectImageMimeType(bytes);
    if (!mimeType) {
      throw new ProviderImageGenerationError(
        `Image generation item ${index} has an unsupported format`,
        'protocol',
      );
    }
    const revisedPrompt =
      typeof record.revised_prompt === 'string' && record.revised_prompt.trim()
        ? scrubSecrets(record.revised_prompt.trim(), [apiKey]).slice(0, 4_000)
        : undefined;
    return { bytes, mimeType, ...(revisedPrompt ? { revisedPrompt } : {}) };
  });
}

function detectImageMimeType(bytes: Uint8Array): ProviderGeneratedImage['mimeType'] | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return undefined;
}

function failureClassForStatus(status: number): FailureClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'transient';
  return 'protocol';
}

function normalizeRequestError(
  error: unknown,
  timeoutController: AbortController,
  request: ProviderImageGenerationRequest,
): ProviderImageGenerationError {
  if (error instanceof ProviderImageGenerationError) return error;
  const timedOut = timeoutController.signal.aborted && !request.signal.aborted;
  const failureClass: FailureClass = timedOut || isAbortError(error) ? 'timeout' : 'transient';
  const message = scrubSecrets(error instanceof Error ? error.message : String(error), [
    request.apiKey,
  ]);
  return new ProviderImageGenerationError(
    timedOut ? 'Image generation timed out' : `Image generation request failed: ${message}`,
    failureClass,
  );
}

function isRetryableImageFailure(failureClass: FailureClass): boolean {
  return (
    failureClass === 'transient' || failureClass === 'timeout' || failureClass === 'rate-limit'
  );
}

function normalizeRetryCount(value: number | undefined): number {
  if (value === undefined) return 2;
  return Math.max(0, Math.min(4, Math.floor(value)));
}

function normalizeRetryDelay(value: number | undefined): number {
  if (value === undefined) return 250;
  return Math.max(0, Math.min(5_000, Math.floor(value)));
}

function retryDelayMs(baseDelayMs: number, retryIndex: number): number {
  return Math.min(5_000, baseDelayMs * 2 ** retryIndex);
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, Math.floor(seconds * 1_000));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(5_000, Math.max(0, timestamp - Date.now()));
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    };
    const done = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(done, delayMs);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function boundedResponseText(response: Response): Promise<string> {
  return previewResponseText(await response.text(), HTTP_ERROR_BODY_CHARS);
}

function previewResponseText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
