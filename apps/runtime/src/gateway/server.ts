/**
 * Open gateway HTTP server (loopback only).
 *
 * Serves two inbound dialects and translates each onto whatever the resolved
 * upstream actually speaks:
 *   POST /anthropic/v1/messages        ← Claude Code / any Anthropic client
 *   POST /openai/v1/chat/completions   ← Codex / any OpenAI client
 *   GET  /healthz                      ← liveness (no auth, no data)
 *
 * Routing precedence:
 *   1. The presented key is a per-run ticket → use the ticket verbatim
 *      (exact provider + model the user picked; body.model is overwritten).
 *   2. The presented key is the external token → resolve `body.model` through
 *      the host's model catalog. Only for terminal clients with no run context.
 * Anything else is rejected with 401.
 *
 * Security: binds 127.0.0.1 only; upstream secrets come from the ticket table
 * and are never echoed into responses or logs; request bodies are capped.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  AnthropicStreamEmitter,
  ChatStreamToResponsesEmitter,
  OpenAIResponsesStreamEmitter,
  OpenAIStreamEmitter,
  SseLineReader,
  anthropicRequestToOpenAIChat,
  anthropicRequestToOpenAIResponses,
  encodeSseFrame,
  normalizeOpenAICompatibleBaseUrl,
  openAIChatRequestToAnthropic,
  openaiResponsesToChat,
  parseSseJson,
  type AnthropicMessagesRequest,
  type OpenAIChatRequest,
  type OpenAIResponsesRequest,
  type OpenAIResponseSseEvent,
  type OpenAIResponsesUsage,
  type OpenAIStreamChunk,
  type OpenAIUsage,
  type SseFrame,
} from '@sync-think/adapters';
import {
  OPEN_GATEWAY_ANTHROPIC_PATH,
  OPEN_GATEWAY_OPENAI_PATH,
  type GatewayRequestLogEntry,
} from '@sync-think/protocol';
import type {
  GatewayRoute,
  GatewayRunUsage,
  GatewayUpstreamProtocol,
} from './tickets.js';

/** 32 MiB cap: large image payloads are legitimate, unbounded bodies are not. */
const REQUEST_BODY_CAP = 32 * 1024 * 1024;
const UPSTREAM_HEADER_TIMEOUT_MS = 120_000;
const GATEWAY_TRACE_ENABLED = process.env.E2E_TRACE_GATEWAY === '1';
/** 审计日志单段 body 截断上限（原始/转换后各 30KB）。 */
const AUDIT_BODY_CAP = 30_000;

export interface OpenGatewayServerOptions {
  port: number;
  /** Resolve a per-run ticket by the key the client presented. */
  resolveTicket(key: string): { runId: string; route: GatewayRoute; kernelId?: string } | undefined;
  /**
   * Resolve a model name for external clients (no run context). Returns
   * undefined when the name is unknown or ambiguous beyond repair.
   */
  resolveModelName?(model: string): GatewayRoute | undefined;
  /** Model catalog snapshot served by `GET /v1/models`. */
  listModels?(): Array<{ id: string; providerId?: string; providerName?: string }>;
  /** Long-lived token accepted from external clients. */
  externalToken: string;
  /** Resolve the provider function_call item id that produced a call. */
  resolveContinuationItem?(scopeId: string, callId: string): string | undefined;
  /** Record the provider function_call item id that produced a call. */
  recordContinuationItem?(scopeId: string, callId: string, itemId: string): void;
  /** Capture provider-authoritative usage for the run that owns a ticket. */
  recordRunUsage?(runId: string, usage: GatewayRunUsage): void;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Diagnostics sink (never receives secrets). */
  onLog?(message: string): void;
  /**
   * Audit sink: called once per proxied/translated request with the inbound
   * body (原始格式), the translated upstream body (转换后格式), and the kernel
   * that drove the run. Never receives secrets (keys ride in headers).
   */
  onRequest?(entry: GatewayRequestLogEntry): void;
}

export interface OpenGatewayServer {
  host: string;
  port: number;
  externalToken: string;
  close(): Promise<void>;
}

export class GatewayPortInUseError extends Error {
  constructor(readonly port: number) {
    super(`gateway port ${port} is already in use`);
    this.name = 'GatewayPortInUseError';
  }
}

/** Generate the long-lived token handed to external CLI clients. */
export function createExternalGatewayToken(): string {
  return `stgx_${randomBytes(24).toString('base64url')}`;
}

function traceGateway(
  options: OpenGatewayServerOptions,
  label: string,
  details: unknown,
): void {
  if (!GATEWAY_TRACE_ENABLED) return;
  options.onLog?.(`[trace] ${label} ${JSON.stringify(details)}`);
}

function summarizeAnthropicMessages(request: AnthropicMessagesRequest): unknown[] {
  return request.messages.map((message, messageIndex) => {
    const blocks =
      typeof message.content === 'string'
        ? [{ type: 'text', length: message.content.length }]
        : message.content.map((block, blockIndex) => {
            if (block.type === 'tool_use') {
              return {
                blockIndex,
                type: block.type,
                id: block.id,
                name: block.name,
              };
            }
            if (block.type === 'tool_result') {
              return {
                blockIndex,
                type: block.type,
                toolUseId: block.tool_use_id,
                isError: block.is_error === true,
              };
            }
            return { blockIndex, type: block.type };
          });
    return { messageIndex, role: message.role, blocks };
  });
}

function summarizeResponsesInput(input: readonly Record<string, unknown>[]): unknown[] {
  return input.map((item, inputIndex) => {
    const type = typeof item.type === 'string' ? item.type : 'message';
    return {
      inputIndex,
      type,
      ...(typeof item.role === 'string' ? { role: item.role } : {}),
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      ...(typeof item.call_id === 'string' ? { callId: item.call_id } : {}),
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
    };
  });
}

function summarizeResponsesEvent(event: OpenAIResponseSseEvent): Record<string, unknown> {
  const raw = event as OpenAIResponseSseEvent & {
    id?: string;
    item_id?: string;
    output_index?: number;
    call_id?: string;
    name?: string;
    item?: {
      type?: string;
      id?: string;
      call_id?: string;
      name?: string;
    };
    response?: { id?: string; status?: string };
  };
  return {
    type: event.type,
    ...(typeof raw.output_index === 'number' ? { outputIndex: raw.output_index } : {}),
    ...(typeof raw.item_id === 'string' ? { itemId: raw.item_id } : {}),
    ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
    ...(typeof raw.call_id === 'string' ? { callId: raw.call_id } : {}),
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(raw.item
      ? {
          item: {
            ...(typeof raw.item.type === 'string' ? { type: raw.item.type } : {}),
            ...(typeof raw.item.id === 'string' ? { id: raw.item.id } : {}),
            ...(typeof raw.item.call_id === 'string'
              ? { callId: raw.item.call_id }
              : {}),
            ...(typeof raw.item.name === 'string' ? { name: raw.item.name } : {}),
          },
        }
      : {}),
    ...(raw.response
      ? {
          response: {
            ...(typeof raw.response.id === 'string' ? { id: raw.response.id } : {}),
            ...(typeof raw.response.status === 'string'
              ? { status: raw.response.status }
              : {}),
          },
        }
      : {}),
  };
}

function responseIdFromResponsesEvent(
  event: OpenAIResponseSseEvent,
): string | undefined {
  const response = (event as { response?: { id?: unknown } }).response;
  return typeof response?.id === 'string' ? response.id : undefined;
}

/** Start the loopback listener; rejects with GatewayPortInUseError on EADDRINUSE. */
export function startOpenGatewayServer(
  options: OpenGatewayServerOptions,
): Promise<OpenGatewayServer> {
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((request, response) => {
    void handleRequest(request, response, options);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      reject(error.code === 'EADDRINUSE' ? new GatewayPortInUseError(options.port) : error);
    };
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port: options.port }, () => {
      server.removeListener('error', onError);
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : options.port;
      resolve({
        host: '127.0.0.1',
        port,
        externalToken: options.externalToken,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            for (const socket of sockets) socket.destroy();
            sockets.clear();
          }),
      });
    });
  });
}

/** Constant-time key comparison so the external token cannot be probed. */
function keysMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function presentedKey(request: IncomingMessage): string {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string' && header !== '') return header;
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  return '';
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > REQUEST_BODY_CAP) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

type InboundDialect = 'anthropic-messages' | 'openai-chat' | 'openai-responses';

/** Match a request path onto an inbound dialect (version segment optional). */
export function matchGatewayRoute(
  pathname: string,
): InboundDialect | 'health' | 'models' | undefined {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/healthz') return 'health';
  // OpenAI-compatible model listing: both the bare and the /openai-scoped path.
  if (path === '/v1/models' || path === `${OPEN_GATEWAY_OPENAI_PATH}/v1/models`) return 'models';
  if (
    path === `${OPEN_GATEWAY_ANTHROPIC_PATH}/v1/messages` ||
    path === `${OPEN_GATEWAY_ANTHROPIC_PATH}/messages`
  ) {
    return 'anthropic-messages';
  }
  if (
    path === `${OPEN_GATEWAY_OPENAI_PATH}/v1/chat/completions` ||
    path === `${OPEN_GATEWAY_OPENAI_PATH}/chat/completions`
  ) {
    return 'openai-chat';
  }
  // Codex speaks the Responses dialect exclusively; it hits
  // `{base}/v1/responses` against the gateway's OpenAI inbound.
  if (
    path === `${OPEN_GATEWAY_OPENAI_PATH}/v1/responses` ||
    path === `${OPEN_GATEWAY_OPENAI_PATH}/responses`
  ) {
    return 'openai-responses';
  }
  return undefined;
}

/**
 * Join an upstream base URL with the endpoint for a dialect (idempotent).
 *
 * Host-only base URLs (e.g. `https://www.kamenking.top` imported from CC
 * Switch) must get the same `/v1` normalization the direct call paths use:
 * appending the endpoint to a bare origin without `/v1` makes upstreams answer
 * with their SPA fallback HTML instead of JSON.
 */
export function upstreamUrlFor(baseUrl: string, protocol: GatewayUpstreamProtocol): string {
  const root = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (protocol === 'anthropic-messages') {
    return /\/messages$/i.test(root) ? root : `${root}/messages`;
  }
  if (protocol === 'openai-responses') {
    return /\/responses$/i.test(root) ? root : `${root}/responses`;
  }
  return /\/chat\/completions$/i.test(root) ? root : `${root}/chat/completions`;
}

function upstreamHeaders(route: GatewayRoute): Record<string, string> {
  if (route.protocol === 'anthropic-messages') {
    return {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-api-key': route.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${route.apiKey}`,
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: OpenGatewayServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const matched = matchGatewayRoute(url.pathname);
  if (matched === 'health') {
    writeJson(response, 200, { ok: true });
    return;
  }
  if (matched === 'models') {
    if (request.method !== 'GET') {
      writeJson(response, 405, {
        error: { type: 'method_not_allowed', message: 'GET required for /v1/models' },
      });
      return;
    }
    const models = options.listModels?.() ?? [];
    writeJson(response, 200, {
      object: 'list',
      data: models.map((model) => ({
        id: model.id,
        object: 'model',
        created: 0,
        owned_by: model.providerName ?? model.providerId ?? 'sync-think',
      })),
    });
    return;
  }
  if (!matched) {
    writeJson(response, 404, { error: { type: 'not_found', message: 'unknown gateway route' } });
    return;
  }
  if (request.method !== 'POST') {
    writeJson(response, 405, { error: { type: 'method_not_allowed', message: 'POST required' } });
    return;
  }

  const key = presentedKey(request);
  const ticket = options.resolveTicket(key);
  let route = ticket?.route;
  const runId = ticket?.runId;
  let modelOverride = true;
  if (!route) {
    // Not a run ticket: only the external token may resolve by model name.
    if (!key || !keysMatch(key, options.externalToken)) {
      writeJson(response, 401, {
        error: { type: 'authentication_error', message: 'invalid gateway credential' },
      });
      return;
    }
    modelOverride = false;
  }

  let body: Record<string, unknown>;
  try {
    const raw = await readBody(request);
    body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  } catch (error) {
    writeJson(response, 400, {
      error: {
        type: 'invalid_request_error',
        message: error instanceof Error ? error.message : 'malformed JSON body',
      },
    });
    return;
  }

  const requestedModel = typeof body.model === 'string' ? body.model : '';
  if (!route) {
    route = options.resolveModelName?.(requestedModel);
    if (!route) {
      writeJson(response, 404, {
        error: {
          type: 'invalid_request_error',
          message: `model ${requestedModel || '(missing)'} is not in the model catalog`,
        },
      });
      return;
    }
  }

  // Ticket routing is authoritative: the user's selected model wins over
  // whatever the kernel wrote into the body.
  const targetModel = modelOverride ? route.providerModelId : route.providerModelId || requestedModel;
  const streamRequested = body.stream !== false;
  const requestId = `stgwreq_${randomBytes(18).toString('base64url')}`;
  const responseContinuationScope =
    route.responseContinuationScopeId ??
    (modelOverride
      ? key
      : `external:${route.providerId ?? route.baseUrl}:${route.protocol}:${targetModel}`);

  const requestStartedAt = Date.now();
  const context: TranslateContext = {
    route,
    targetModel,
    options,
    streamRequested,
    responseContinuationScope,
    runId,
    requestId,
  };
  try {
    if (matched === route.protocol) {
      await proxyDirect(response, body, context);
      return;
    }
    if (matched === 'anthropic-messages') {
      if (route.protocol === 'openai-chat') {
        await translateAnthropicToOpenAI(response, body as unknown as AnthropicMessagesRequest, context);
        return;
      }
      if (route.protocol === 'openai-responses') {
        await translateAnthropicToOpenAIResponses(
          response,
          body as unknown as AnthropicMessagesRequest,
          context,
        );
        return;
      }
    }
    if (matched === 'openai-responses') {
      // Codex inbound speaking Responses against a Chat-Completions upstream:
      // translate responses→chat. The same-dialect case (Responses upstream)
      // was already handled by `matched === route.protocol` above.
      if (route.protocol === 'openai-chat') {
        await translateOpenAIResponsesToChat(response, body as unknown as OpenAIResponsesRequest, context);
        return;
      }
      throw new Error(
        'openai-responses inbound → anthropic-messages upstream translation is not supported yet',
      );
    }
    if (route.protocol === 'openai-responses') {
      // Codex (OpenAI-inbound) against a Responses-only upstream is not wired
      // yet: fail loudly instead of mistranslating the dialect.
      throw new Error(
        'openai-chat inbound → openai-responses upstream translation is not supported yet',
      );
    }
    await translateOpenAIToAnthropic(response, body as unknown as OpenAIChatRequest, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'gateway upstream failure';
    options.onLog?.(`gateway upstream failure: ${message}`);
    context.audit = { upstreamBody: body, error: message };
    if (!response.headersSent) {
      writeJson(response, 502, { error: { type: 'api_error', message } });
      return;
    }
    response.end();
  } finally {
    // 审计：每次转换/直通请求记录（原始格式 + 转换后格式 + 内核）。
    const raw = truncateAuditBody(JSON.stringify(body));
    const converted = truncateAuditBody(JSON.stringify(context.audit?.upstreamBody ?? body));
    options.onRequest?.({
      id: requestId,
      occurredAt: new Date().toISOString(),
      kernelId: ticket?.kernelId ?? 'external',
      ...(ticket?.runId ? { runId: ticket.runId } : {}),
      inboundDialect: matched as InboundDialect,
      upstreamProtocol: route.protocol,
      converted: matched !== route.protocol,
      model: targetModel,
      rawRequest: raw.text,
      convertedRequest: converted.text,
      truncated: raw.truncated || converted.truncated,
      status: context.audit?.error ? 'error' : 'success',
      ...(context.audit?.statusCode !== undefined
        ? { statusCode: context.audit.statusCode }
        : {}),
      ...(context.audit?.error ? { errorMessage: context.audit.error } : {}),
      latencyMs: Date.now() - requestStartedAt,
    });
  }
}

function beginSse(response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
}

function writeFrames(response: ServerResponse, frames: SseFrame[]): void {
  for (const frame of frames) response.write(encodeSseFrame(frame));
}

async function callUpstream(
  route: GatewayRoute,
  body: unknown,
  options: OpenGatewayServerOptions,
  signal: AbortSignal,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return fetchImpl(upstreamUrlFor(route.baseUrl, route.protocol), {
    method: 'POST',
    headers: upstreamHeaders(route),
    body: JSON.stringify(body),
    signal,
  });
}

/** Abort the upstream call when the client disconnects or headers stall. */
function upstreamAbort(response: ServerResponse): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_HEADER_TIMEOUT_MS);
  const onClose = (): void => controller.abort();
  response.on('close', onClose);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      response.off('close', onClose);
    },
  };
}

/** Same dialect on both sides: only the model + credentials are rewritten. */
async function proxyDirect(
  response: ServerResponse,
  body: Record<string, unknown>,
  context: TranslateContext,
): Promise<void> {
  const abort = upstreamAbort(response);
  try {
    const upstreamBody = { ...body, model: context.targetModel };
    context.audit = { upstreamBody };
    const upstream = await callUpstream(
      context.route,
      upstreamBody,
      context.options,
      abort.signal,
    );
    if (!upstream.ok || !upstream.body || !context.streamRequested) {
      const text = await upstream.text();
      if (upstream.ok) captureDirectJsonUsage(text, context);
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      });
      response.end(text);
      return;
    }
    beginSse(response);
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const usageReader = new SseLineReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      captureDirectSseUsage(usageReader.push(text), context);
      response.write(text);
    }
    const tail = decoder.decode();
    if (tail) {
      captureDirectSseUsage(usageReader.push(tail), context);
      response.write(tail);
    }
    captureDirectSseUsage(usageReader.flush(), context);
    response.end();
  } finally {
    abort.dispose();
  }
}

interface TranslateContext {
  route: GatewayRoute;
  targetModel: string;
  options: OpenGatewayServerOptions;
  streamRequested: boolean;
  responseContinuationScope?: string;
  runId?: string;
  requestId: string;
  providerResponseId?: string;
  providerModelId?: string;
  /**
   * 审计收集：翻译函数设置转换后的 upstream body；直通时设置改写后的 body。
   * handleRequest 在请求收尾（finally）统一组装日志条目。
   */
  audit?: { upstreamBody: unknown; statusCode?: number; error?: string };
}

/** 截断审计 body：JSON 文本超限时保留头部并标记截断。 */
function truncateAuditBody(jsonText: string): { text: string; truncated: boolean } {
  if (jsonText.length <= AUDIT_BODY_CAP) return { text: jsonText, truncated: false };
  return { text: `${jsonText.slice(0, AUDIT_BODY_CAP)}\n… (truncated)`, truncated: true };
}

/** Anthropic inbound → OpenAI upstream (Claude Code driving a gpt model). */
async function translateAnthropicToOpenAI(
  response: ServerResponse,
  inbound: AnthropicMessagesRequest,
  context: TranslateContext,
): Promise<void> {
  const upstreamBody = anthropicRequestToOpenAIChat(inbound, {
    targetModel: context.targetModel,
  });
  if (!context.streamRequested) upstreamBody.stream = false;
  context.audit = { upstreamBody };
  const abort = upstreamAbort(response);
  const emitter = new AnthropicStreamEmitter(
    `msg_${randomBytes(12).toString('hex')}`,
    context.targetModel,
  );
  try {
    const upstream = await callUpstream(context.route, upstreamBody, context.options, abort.signal);
    if (!upstream.ok) {
      await failTranslated(response, upstream, context);
      return;
    }
    if (!upstream.body || upstreamBody.stream === false) {
      // Non-streaming upstream: convert the single completion into one stream.
      const payload = (await upstream.json()) as {
        id?: string;
        model?: string;
        choices?: Array<{
          message?: { content?: string; tool_calls?: OpenAIStreamChunk['choices'] };
          finish_reason?: string;
        }>;
        usage?: OpenAIUsage;
      };
      captureOpenAIUsage(context, payload.usage, payload.id, payload.model);
      beginSse(response);
      const choice = payload.choices?.[0];
      const chunk: OpenAIStreamChunk = {
        choices: [
          {
            index: 0,
            delta: {
              ...(typeof choice?.message?.content === 'string'
                ? { content: choice.message.content }
                : {}),
              ...(Array.isArray(choice?.message?.tool_calls)
                ? { tool_calls: choice.message.tool_calls as never }
                : {}),
            },
            finish_reason: (choice?.finish_reason as never) ?? 'stop',
          },
        ],
      };
      writeFrames(response, emitter.push(chunk));
      writeFrames(response, emitter.finish());
      response.end();
      return;
    }
    beginSse(response);
    const reader = new SseLineReader();
    const streamReader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await streamReader.read();
      if (done) break;
      for (const message of reader.push(decoder.decode(value, { stream: true }))) {
        const chunk = parseSseJson<OpenAIStreamChunk>(message.data);
        if (!chunk) continue;
        const upstreamError = (chunk as { error?: { message?: string } }).error;
        if (upstreamError) {
          writeFrames(response, emitter.error(upstreamError.message ?? 'upstream error'));
          response.end();
          return;
        }
        captureOpenAIUsage(context, chunk.usage ?? undefined, chunk.id, chunk.model);
        writeFrames(response, emitter.push(chunk));
      }
    }
    for (const message of reader.flush()) {
      const chunk = parseSseJson<OpenAIStreamChunk>(message.data);
      if (chunk) {
        captureOpenAIUsage(context, chunk.usage ?? undefined, chunk.id, chunk.model);
        writeFrames(response, emitter.push(chunk));
      }
    }
    writeFrames(response, emitter.finish());
    response.end();
  } finally {
    abort.dispose();
  }
}

/**
 * Anthropic inbound → OpenAI Responses upstream (Claude Code driving a model
 * that only the Responses API serves).
 */
async function translateAnthropicToOpenAIResponses(
  response: ServerResponse,
  inbound: AnthropicMessagesRequest,
  context: TranslateContext,
): Promise<void> {
  traceGateway(context.options, 'anthropic.inbound', {
    requestId: context.requestId,
    messages: summarizeAnthropicMessages(inbound),
  });
  const upstreamBody = anthropicRequestToOpenAIResponses(inbound, {
    targetModel: context.targetModel,
    resolveFunctionItemId: (callId) => {
      const itemId = context.responseContinuationScope
        ? context.options.resolveContinuationItem?.(
            context.responseContinuationScope,
            callId,
          )
        : undefined;
      traceGateway(context.options, 'responses.continuation.resolve', {
        requestId: context.requestId,
        callId,
        itemId: itemId ?? null,
      });
      return itemId;
    },
  });
  traceGateway(context.options, 'responses.upstream-input', {
    requestId: context.requestId,
    input: summarizeResponsesInput(
      upstreamBody.input as unknown as readonly Record<string, unknown>[],
    ),
  });
  if (!context.streamRequested) upstreamBody.stream = false;
  context.audit = { upstreamBody };
  const abort = upstreamAbort(response);
  const functionCallItems = new Map<string, string>();
  let providerResponseId: string | undefined;
  const persistFunctionCallItems = (): void => {
    if (!context.responseContinuationScope) return;
    for (const [callId, itemId] of functionCallItems) {
      context.options.recordContinuationItem?.(
        context.responseContinuationScope,
        callId,
        itemId,
      );
      traceGateway(context.options, 'responses.continuation.record', {
        requestId: context.requestId,
        callId,
        itemId,
      });
    }
  };
  const observeProviderResponseId = (candidate: string | undefined): void => {
    const responseId = candidate?.trim();
    if (!responseId || responseId === providerResponseId) return;
    providerResponseId = responseId;
    context.providerResponseId = responseId;
  };
  const emitter = new OpenAIResponsesStreamEmitter(
    `msg_${randomBytes(12).toString('hex')}`,
    context.targetModel,
    (callId, itemId) => {
      if (!callId || !itemId) return;
      functionCallItems.set(callId, itemId);
      persistFunctionCallItems();
    },
  );
  try {
    const upstreamStartedAt = Date.now();
    const upstream = await callUpstream(context.route, upstreamBody, context.options, abort.signal);
    traceGateway(context.options, 'responses.upstream-response', {
      requestId: context.requestId,
      status: upstream.status,
      elapsedMs: Date.now() - upstreamStartedAt,
    });
    if (!upstream.ok) {
      await failTranslated(response, upstream, context);
      return;
    }
    if (!upstream.body || upstreamBody.stream === false) {
      // Non-streaming upstream: replay the completed response body through the
      // emitter's `response.completed` path so both modes share one translation.
      const payload = (await upstream.json()) as {
        id?: string;
        model?: string;
        status?: string;
        output?: unknown[];
        usage?: OpenAIResponsesUsage;
        error?: { message?: string };
      };
      observeProviderResponseId(payload.id);
      captureOpenAIResponsesUsage(
        context,
        payload.usage,
        payload.id,
        payload.model,
      );
      beginSse(response);
      if (payload.error) {
        writeFrames(response, emitter.error(payload.error.message ?? 'upstream error'));
      } else {
        writeFrames(
          response,
          emitter.push({
            type: 'response.completed',
            response: payload as never,
          }),
        );
        writeFrames(response, emitter.finish());
      }
      response.end();
      return;
    }
    beginSse(response);
    const reader = new SseLineReader();
    const streamReader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await streamReader.read();
      if (done) break;
      for (const message of reader.push(decoder.decode(value, { stream: true }))) {
        const event = parseSseJson<OpenAIResponseSseEvent>(message.data);
        if (!event) continue;
        observeProviderResponseId(responseIdFromResponsesEvent(event));
        traceGateway(
          context.options,
          'responses.sse',
          summarizeResponsesEvent(event),
        );
        captureOpenAIResponsesEventUsage(context, event);
        writeFrames(response, emitter.push(event));
      }
    }
    for (const message of reader.flush()) {
      const event = parseSseJson<OpenAIResponseSseEvent>(message.data);
      if (event) {
        observeProviderResponseId(responseIdFromResponsesEvent(event));
        traceGateway(
          context.options,
          'responses.sse',
          summarizeResponsesEvent(event),
        );
        captureOpenAIResponsesEventUsage(context, event);
        writeFrames(response, emitter.push(event));
      }
    }
    writeFrames(response, emitter.finish());
    response.end();
  } finally {
    abort.dispose();
  }
}

/**
 * OpenAI Responses inbound → Chat-Completions upstream (Codex driving a model
 * that only a Chat relay serves, e.g. DeepSeek official with no /responses
 * endpoint). Rewrites the Responses request body, forwards to /chat/completions
 * and translates the Chat SSE stream back into Responses events.
 */
async function translateOpenAIResponsesToChat(
  response: ServerResponse,
  inbound: OpenAIResponsesRequest,
  context: TranslateContext,
): Promise<void> {
  const { body: upstreamBody, toolNamespaceMap } = openaiResponsesToChat(inbound, {
    targetModel: context.targetModel,
  });
  if (!context.streamRequested) upstreamBody.stream = false;
  context.audit = { upstreamBody };
  const abort = upstreamAbort(response);
  const emitter = new ChatStreamToResponsesEmitter(
    `resp_${randomBytes(12).toString('hex')}`,
    context.targetModel,
    toolNamespaceMap,
  );
  try {
    const upstream = await callUpstream(context.route, upstreamBody, context.options, abort.signal);
    if (!upstream.ok) {
      await failTranslated(response, upstream, context);
      return;
    }
    if (!upstream.body || upstreamBody.stream === false) {
      // Non-streaming upstream: convert the single completion into one stream.
      const payload = (await upstream.json()) as {
        id?: string;
        model?: string;
        choices?: Array<{
          message?: { content?: string; tool_calls?: OpenAIStreamChunk['choices'] };
          finish_reason?: string;
        }>;
        usage?: OpenAIUsage;
      };
      captureOpenAIUsage(context, payload.usage, payload.id, payload.model);
      beginSse(response);
      const choice = payload.choices?.[0];
      const chunk: OpenAIStreamChunk = {
        choices: [
          {
            index: 0,
            delta: {
              ...(typeof choice?.message?.content === 'string'
                ? { content: choice.message.content }
                : {}),
              ...(Array.isArray(choice?.message?.tool_calls)
                ? { tool_calls: choice.message.tool_calls as never }
                : {}),
            },
            finish_reason: (choice?.finish_reason as never) ?? 'stop',
          },
        ],
      };
      writeFrames(response, emitter.push(chunk));
      writeFrames(response, emitter.finish());
      response.end();
      return;
    }
    beginSse(response);
    const reader = new SseLineReader();
    const streamReader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await streamReader.read();
      if (done) break;
      for (const message of reader.push(decoder.decode(value, { stream: true }))) {
        const chunk = parseSseJson<OpenAIStreamChunk>(message.data);
        if (!chunk) continue;
        const upstreamError = (chunk as { error?: { message?: string } }).error;
        if (upstreamError) {
          writeFrames(response, emitter.error(upstreamError.message ?? 'upstream error'));
          response.end();
          return;
        }
        captureOpenAIUsage(context, chunk.usage ?? undefined, chunk.id, chunk.model);
        writeFrames(response, emitter.push(chunk));
      }
    }
    for (const message of reader.flush()) {
      const chunk = parseSseJson<OpenAIStreamChunk>(message.data);
      if (chunk) {
        captureOpenAIUsage(context, chunk.usage ?? undefined, chunk.id, chunk.model);
        writeFrames(response, emitter.push(chunk));
      }
    }
    writeFrames(response, emitter.finish());
    response.end();
  } finally {
    abort.dispose();
  }
}

/** OpenAI inbound → Anthropic upstream (Codex driving a Claude model). */
async function translateOpenAIToAnthropic(
  response: ServerResponse,
  inbound: OpenAIChatRequest,
  context: TranslateContext,
): Promise<void> {
  const upstreamBody = openAIChatRequestToAnthropic(inbound, {
    targetModel: context.targetModel,
  });
  if (!context.streamRequested) upstreamBody.stream = false;
  context.audit = { upstreamBody };
  const abort = upstreamAbort(response);
  const emitter = new OpenAIStreamEmitter(
    `chatcmpl-${randomBytes(12).toString('hex')}`,
    context.targetModel,
  );
  try {
    const upstream = await callUpstream(context.route, upstreamBody, context.options, abort.signal);
    if (!upstream.ok) {
      await failTranslated(response, upstream, context);
      return;
    }
    if (!upstream.body || upstreamBody.stream === false) {
      const payload = (await upstream.json()) as {
        id?: string;
        model?: string;
        content?: Array<Record<string, unknown>>;
        stop_reason?: string;
        usage?: Record<string, unknown>;
      };
      captureAnthropicUsage(context, payload.usage, payload.id, payload.model);
      beginSse(response);
      // Replay a non-streaming Anthropic body as the SSE events the emitter expects.
      writeFrames(response, emitter.push({ type: 'message_start', message: { usage: payload.usage } }));
      let index = 0;
      for (const block of payload.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string') {
          writeFrames(
            response,
            emitter.push({
              type: 'content_block_delta',
              index,
              delta: { type: 'text_delta', text: block.text },
            }),
          );
        } else if (block.type === 'tool_use') {
          writeFrames(
            response,
            emitter.push({
              type: 'content_block_start',
              index,
              content_block: {
                type: 'tool_use',
                id: typeof block.id === 'string' ? block.id : '',
                name: typeof block.name === 'string' ? block.name : '',
              },
            }),
          );
          writeFrames(
            response,
            emitter.push({
              type: 'content_block_delta',
              index,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
            }),
          );
        }
        index += 1;
      }
      writeFrames(
        response,
        emitter.push({
          type: 'message_delta',
          delta: { stop_reason: payload.stop_reason ?? 'end_turn' },
          usage: payload.usage,
        }),
      );
      writeFrames(response, emitter.finish());
      response.end();
      return;
    }
    beginSse(response);
    const reader = new SseLineReader();
    const streamReader = upstream.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await streamReader.read();
      if (done) break;
      for (const message of reader.push(decoder.decode(value, { stream: true }))) {
        const event = parseSseJson<Record<string, unknown>>(message.data);
        if (!event) continue;
        // Anthropic puts the type in the payload; fall back to the event line.
        if (typeof event.type !== 'string' && message.event) event.type = message.event;
        captureAnthropicEventUsage(context, event);
        writeFrames(response, emitter.push(event as never));
      }
    }
    for (const message of reader.flush()) {
      const event = parseSseJson<Record<string, unknown>>(message.data);
      if (event) {
        if (typeof event.type !== 'string' && message.event) event.type = message.event;
        captureAnthropicEventUsage(context, event);
        writeFrames(response, emitter.push(event as never));
      }
    }
    writeFrames(response, emitter.finish());
    response.end();
  } finally {
    abort.dispose();
  }
}

function captureDirectSseUsage(messages: SseFrame[], context: TranslateContext): void {
  for (const message of messages) {
    if (context.route.protocol === 'anthropic-messages') {
      const event = parseSseJson<Record<string, unknown>>(message.data);
      if (!event) continue;
      if (typeof event.type !== 'string' && message.event) event.type = message.event;
      captureAnthropicEventUsage(context, event);
      continue;
    }
    if (context.route.protocol === 'openai-responses') {
      const event = parseSseJson<OpenAIResponseSseEvent>(message.data);
      if (event) captureOpenAIResponsesEventUsage(context, event);
      continue;
    }
    const chunk = parseSseJson<OpenAIStreamChunk>(message.data);
    if (chunk) {
      captureOpenAIUsage(context, chunk.usage ?? undefined, chunk.id, chunk.model);
    }
  }
}

function captureDirectJsonUsage(text: string, context: TranslateContext): void {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return;
  }
  const providerResponseId = stringValue(payload.id);
  const providerModelId = stringValue(payload.model);
  if (context.route.protocol === 'anthropic-messages') {
    captureAnthropicUsage(
      context,
      recordValue(payload.usage),
      providerResponseId,
      providerModelId,
    );
    return;
  }
  if (context.route.protocol === 'openai-responses') {
    captureOpenAIResponsesUsage(
      context,
      recordValue(payload.usage) as OpenAIResponsesUsage | undefined,
      providerResponseId,
      providerModelId,
    );
    return;
  }
  captureOpenAIUsage(
    context,
    recordValue(payload.usage) as OpenAIUsage | undefined,
    providerResponseId,
    providerModelId,
  );
}

function captureAnthropicEventUsage(
  context: TranslateContext,
  event: Record<string, unknown>,
): void {
  const message = recordValue(event.message);
  captureAnthropicUsage(
    context,
    recordValue(event.usage) ?? recordValue(message?.usage),
    stringValue(message?.id),
    stringValue(message?.model),
  );
}

function captureAnthropicUsage(
  context: TranslateContext,
  usage: Record<string, unknown> | undefined,
  providerResponseId?: string,
  providerModelId?: string,
): void {
  if (!usage) return;
  const input = numberValue(usage.input_tokens);
  const output = numberValue(usage.output_tokens);
  const cachedTokensHit = optionalNumberValue(usage.cache_read_input_tokens);
  const cachedTokensCreated = optionalNumberValue(usage.cache_creation_input_tokens);
  const tokensIn = input + (cachedTokensHit ?? 0) + (cachedTokensCreated ?? 0);
  recordProviderUsage(context, {
    providerResponseId,
    providerModelId,
    tokensIn,
    tokensOut: output,
    cachedTokensHit,
    cachedTokensCreated,
    totalTokens: tokensIn + output,
  });
}

function captureOpenAIResponsesEventUsage(
  context: TranslateContext,
  event: OpenAIResponseSseEvent,
): void {
  if (event.type !== 'response.completed' && event.type !== 'response.failed') return;
  captureOpenAIResponsesUsage(
    context,
    event.response?.usage,
    event.response?.id,
    event.response?.model,
  );
}

function captureOpenAIResponsesUsage(
  context: TranslateContext,
  usage: OpenAIResponsesUsage | undefined,
  providerResponseId?: string,
  providerModelId?: string,
): void {
  if (!usage) return;
  const tokensIn = numberValue(usage.input_tokens);
  const tokensOut = numberValue(usage.output_tokens);
  recordProviderUsage(context, {
    providerResponseId,
    providerModelId,
    tokensIn,
    tokensOut,
    cachedTokensHit: optionalNumberValue(usage.input_tokens_details?.cached_tokens),
    cachedTokensCreated: optionalNumberValue(
      usage.input_tokens_details?.cache_write_tokens,
    ),
    reasoningTokens: optionalNumberValue(
      usage.output_tokens_details?.reasoning_tokens,
    ),
    totalTokens: optionalNumberValue(usage.total_tokens) ?? tokensIn + tokensOut,
  });
}

function captureOpenAIUsage(
  context: TranslateContext,
  usage: OpenAIUsage | undefined,
  providerResponseId?: string,
  providerModelId?: string,
): void {
  if (!usage) return;
  const tokensIn = numberValue(usage.prompt_tokens);
  const tokensOut = numberValue(usage.completion_tokens);
  // DeepSeek relays report cache via `prompt_cache_hit_tokens` instead of the
  // standard `prompt_tokens_details.cached_tokens`; honor both so cache shows up
  // instead of reading as "not reported".
  const cachedTokensHit =
    optionalNumberValue(usage.prompt_tokens_details?.cached_tokens) ??
    optionalNumberValue(usage.prompt_cache_hit_tokens);
  recordProviderUsage(context, {
    providerResponseId,
    providerModelId,
    tokensIn,
    tokensOut,
    cachedTokensHit,
    cachedTokensCreated: optionalNumberValue(
      usage.prompt_tokens_details?.cache_write_tokens,
    ),
    reasoningTokens: optionalNumberValue(
      usage.completion_tokens_details?.reasoning_tokens,
    ),
    totalTokens: optionalNumberValue(usage.total_tokens) ?? tokensIn + tokensOut,
  });
}

function recordProviderUsage(
  context: TranslateContext,
  usage: Omit<
    GatewayRunUsage,
    'requestId' | 'providerId' | 'providerModelId'
  > & { providerModelId?: string },
): void {
  if (!context.runId || !context.options.recordRunUsage) return;
  if (usage.providerResponseId) context.providerResponseId = usage.providerResponseId;
  if (usage.providerModelId) context.providerModelId = usage.providerModelId;
  context.options.recordRunUsage(context.runId, {
    requestId: context.requestId,
    ...(context.providerResponseId
      ? { providerResponseId: context.providerResponseId }
      : {}),
    ...(context.route.providerId ? { providerId: context.route.providerId } : {}),
    providerModelId: context.providerModelId ?? context.targetModel,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    ...(usage.cachedTokensHit !== undefined
      ? { cachedTokensHit: usage.cachedTokensHit }
      : {}),
    ...(usage.cachedTokensCreated !== undefined
      ? { cachedTokensCreated: usage.cachedTokensCreated }
      : {}),
    ...(usage.reasoningTokens !== undefined
      ? { reasoningTokens: usage.reasoningTokens }
      : {}),
    totalTokens: usage.totalTokens,
  });
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function numberValue(value: unknown): number {
  return optionalNumberValue(value) ?? 0;
}

/**
 * Upstream rejected the call before any stream data. The status is preserved so
 * the kernel's own classification (auth / rate limit / retry) still works, and
 * the body is shaped as an error object both dialects understand. Upstream text
 * is passed through truncated; gateway credentials never appear in it.
 */
async function failTranslated(
  response: ServerResponse,
  upstream: Response,
  context: TranslateContext,
): Promise<void> {
  if (context.audit) {
    context.audit.statusCode = upstream.status;
    context.audit.error = `upstream ${upstream.status} rejected`;
  }
  const text = await upstream.text().catch(() => '');
  const snippet = text.slice(0, 2_000);
  let diagnosticMessage = '';
  let diagnosticType = '';
  try {
    const payload = JSON.parse(text) as {
      error?: { type?: unknown; code?: unknown; message?: unknown };
      message?: unknown;
    };
    diagnosticMessage =
      typeof payload.error?.message === 'string'
        ? payload.error.message
        : typeof payload.message === 'string'
          ? payload.message
          : '';
    diagnosticType =
      typeof payload.error?.type === 'string'
        ? payload.error.type
        : typeof payload.error?.code === 'string'
          ? payload.error.code
          : '';
  } catch {
    diagnosticMessage = upstream.statusText;
  }
  traceGateway(context.options, 'upstream.rejected', {
    requestId: context.requestId,
    status: upstream.status,
    ...(diagnosticType ? { type: diagnosticType } : {}),
    ...(diagnosticMessage ? { message: diagnosticMessage.slice(0, 1_000) } : {}),
  });
  const message = `upstream ${upstream.status}: ${snippet || upstream.statusText}`;
  writeJson(response, upstream.status, {
    type: 'error',
    error: { type: upstream.status === 401 ? 'authentication_error' : 'api_error', message },
  });
}
