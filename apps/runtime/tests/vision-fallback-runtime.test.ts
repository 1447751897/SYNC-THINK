import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteEventCheckpointStore,
  SqliteProviderStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly retain a handle after a failure.
    }
  }
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function createFrameInbox(socket: Socket) {
  const frames: Frame[] = [];
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (waiter) {
        waiters.delete(frame.id);
        waiter(frame);
      } else {
        frames.push(frame);
      }
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

/** Records calls; describes images when content parts carry an image. */
class VisionRecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  calls: ProviderCallRequest[] = [];
  constructor(private readonly failVision = false) {}
  async discoverModels(): Promise<string[]> {
    return ['deepseek-v4-flash', 'gpt-4o-describe'];
  }
  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: request.apiKey ? '[present]' : '' });
    const content = request.messages[0]?.content;
    const hasImagePart = Array.isArray(content) && content.some((part) => part.type === 'image');
    if (hasImagePart) {
      if (this.failVision) {
        yield {
          type: 'error',
          failureClass: 'transient',
          message: 'simulated vision failure',
        };
        return;
      }
      yield { type: 'text-delta', text: '【模拟视觉描述】一只坐在窗台上的猫。' };
    } else {
      const text = typeof content === 'string' ? content : '';
      yield { type: 'text-delta', text: `answer:${text.slice(0, 40)}` };
    }
    yield { type: 'finished', reason: 'stop' };
  }
}

interface Fixture {
  runtime: Runtime;
  installId: string;
  deepseekModelId: string;
  visionModelId: string;
  adapter: VisionRecordingAdapter;
  ocrPaths: string[];
  connection: Awaited<ReturnType<typeof openDatabaseAsync>>;
  store: SqliteEventCheckpointStore;
  threadId: string;
  workspaceRoot?: string;
}

async function setupFixture(options: {
  fallbackEnabled: boolean;
  modelId: string;
  bindWorkspace?: boolean;
  failVision?: boolean;
  failOcr?: boolean;
}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-vision-fallback-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `test-vision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = 'workspace-vision' as WorkspaceId;
  const checkpointRunId = `runtime-${installId}` as RunId;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const store = new SqliteEventCheckpointStore(connection.raw);
  const providerStore = new SqliteProviderStore(connection.raw);
  const appSettingStore = new SqliteAppSettingStore(connection.raw);
  const workspaceStore = options.bindWorkspace
    ? new SqliteWorkspaceStore(connection.raw)
    : undefined;
  let threadId = 'thread-vision';
  let workspaceRoot: string | undefined;
  if (workspaceStore) {
    workspaceRoot = join(dir, 'workspace');
    mkdirSync(workspaceRoot, { recursive: true });
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Vision OCR workspace',
      folderPath: workspaceRoot,
      allowedRoots: [workspaceRoot],
    });
    threadId = workspaceStore.createTask({
      workspaceId,
      title: 'Vision OCR task',
      goal: 'Exercise image adaptation',
    }).threadId;
  }
  const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
  const handle = await secureStore.storeSecret('sk-VISION_TEST_KEY');
  const created = providerStore.createProvider({
    name: 'Vision Gateway',
    baseUrl: 'https://vision.example/v1',
    protocol: 'openai-chat',
    storeHandle: handle,
  });
  const models = providerStore.upsertModels({
    providerId: created.provider.id,
    protocol: 'openai-chat',
    models: [
      { providerModelId: 'deepseek-v4-flash', displayName: 'DeepSeek Flash' },
      { providerModelId: 'gpt-4o-describe', displayName: 'GPT-4o Describe' },
    ],
  });
  const deepseekModel = models.find((model) => model.providerModelId === 'deepseek-v4-flash')!;
  const visionModel = models.find((model) => model.providerModelId === 'gpt-4o-describe')!;
  appSettingStore.set('vision-fallback', {
    enabled: options.fallbackEnabled,
    modelId: options.modelId,
  });
  const adapter = new VisionRecordingAdapter(options.failVision);
  const ocrPaths: string[] = [];
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    workspaceId,
    checkpointRunId,
    providerStore,
    workspaceStore,
    secureStore,
    appSettingStore,
    discoveryByProtocol: { 'openai-chat': adapter },
    windowsOcrRecognizer: async (imagePath) => {
      ocrPaths.push(imagePath);
      if (options.failOcr) throw new Error('simulated OCR failure');
      return { text: 'OCR 提取文字：设置 > 模型', language: 'zh-Hans' };
    },
  });
  await runtime.start();
  return {
    runtime,
    installId,
    deepseekModelId: deepseekModel.id,
    visionModelId: visionModel.id,
    adapter,
    ocrPaths,
    connection,
    store,
    threadId,
    workspaceRoot,
  };
}

async function appendImage(fixture: Fixture, text: string, modelId: string): Promise<Frame> {
  const socket = await connectRuntime(fixture.installId);
  const inbox = createFrameInbox(socket);
  try {
    await inbox.send({
      id: 'hello',
      kind: 'request',
      type: '__hello',
      payload: {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId: fixture.installId,
        nonce: 'vision-fallback',
        features: ['task.appendMessage'],
      },
    });
    return await inbox.send({
      id: 'append',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: fixture.threadId,
        expectedTaskVersion: 0,
        role: 'user',
        text,
        modelId,
        images: [
          {
            name: 'cat.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,QUJDRA==',
          },
        ],
      },
    });
  } finally {
    socket.destroy();
  }
}

describe('vision fallback driven by the Settings 图片识别 Fallback option', () => {
  it('uses the CONFIGURED vision model when enabled; main call receives prose only', async () => {
    const fixture = await setupFixture({ fallbackEnabled: true, modelId: 'gpt-4o-describe' });
    try {
      const append = await appendImage(fixture, '看图', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('described');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // 描述调用用的正是配置的模型，而不是目录里自动挑的
      const describeCall = fixture.adapter.calls.find(
        (call) =>
          Array.isArray(call.messages[0]?.content) &&
          (call.messages[0]!.content as Array<{ type?: string }>).some(
            (part) => part.type === 'image',
          ),
      );
      expect(describeCall).toBeTruthy();
      expect(describeCall!.modelId).toBe('gpt-4o-describe');

      // 主对话调用只有文本（含描述），不带图片部分
      const mainCall = fixture.adapter.calls.at(-1)!;
      const content = mainCall.messages[0]!.content;
      expect(typeof content).toBe('string');
      expect(content as string).toContain('【图片 1 · cat.png】');
      expect(content as string).toContain('一只坐在窗台上的猫');

      expect(fixture.store.listEvents('workspace-vision', 0)).toContainEqual(
        expect.objectContaining({
          type: 'run.started',
          payload: expect.objectContaining({ imagesMode: 'described' }),
        }),
      );
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('forwards raw images directly when the bound model supports vision', async () => {
    const fixture = await setupFixture({ fallbackEnabled: true, modelId: 'gpt-4o-describe' });
    try {
      const append = await appendImage(fixture, '看图', fixture.visionModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('forwarded');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fixture.adapter.calls).toHaveLength(1);
      expect(fixture.ocrPaths).toHaveLength(0);
      const content = fixture.adapter.calls[0]!.messages[0]!.content;
      expect(Array.isArray(content)).toBe(true);
      expect((content as Array<{ type?: string }>).some((part) => part.type === 'image')).toBe(
        true,
      );
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('runs Windows OCR automatically when the visual Fallback switch is off', async () => {
    const fixture = await setupFixture({ fallbackEnabled: false, modelId: 'gpt-4o-describe' });
    try {
      const append = await appendImage(fixture, '看图', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('ocr');
      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fixture.adapter.calls).toHaveLength(1);
      expect(fixture.ocrPaths).toHaveLength(1);
      const mainCall = fixture.adapter.calls[0]!;
      const content = mainCall.messages[0]!.content;
      expect(typeof content).toBe('string');
      expect(content as string).toContain('Windows OCR');
      expect(content as string).toContain('设置 > 模型');
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('falls through to Windows OCR when the configured vision model fails', async () => {
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      failVision: true,
    });
    try {
      const append = await appendImage(fixture, '请读取截图', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('ocr');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fixture.adapter.calls).toHaveLength(2);
      expect(fixture.adapter.calls[0]!.modelId).toBe('gpt-4o-describe');
      expect(fixture.ocrPaths).toHaveLength(1);
      expect(fixture.adapter.calls[1]!.messages[0]!.content).toContain('OCR 提取文字');
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('runs OCR in the host even when a workspace is bound instead of asking the model to call a tool', async () => {
    const fixture = await setupFixture({
      fallbackEnabled: false,
      modelId: 'gpt-4o-describe',
      bindWorkspace: true,
    });
    try {
      const append = await appendImage(fixture, '请读取截图文字', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('ocr');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fixture.adapter.calls).toHaveLength(1);
      const content = fixture.adapter.calls[0]!.messages[0]!.content;
      expect(typeof content).toBe('string');
      expect(content as string).toContain('OCR 提取文字');
      expect(content as string).not.toContain('ocr_image');
      expect(fixture.ocrPaths).toHaveLength(1);
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('does not forward raw images to a text model when both visual fallback and OCR fail', async () => {
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      failVision: true,
      failOcr: true,
    });
    try {
      const append = await appendImage(fixture, '请读取截图', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('failed');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const mainContent = fixture.adapter.calls.at(-1)!.messages[0]!.content;
      expect(typeof mainContent).toBe('string');
      expect(mainContent as string).toContain('图片预处理失败');
      expect(fixture.ocrPaths).toHaveLength(1);
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});
