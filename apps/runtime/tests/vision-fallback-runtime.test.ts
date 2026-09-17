import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteProviderStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { ModelId, RunId, WorkspaceId } from '@sync-think/shared';
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
  constructor(private readonly failVision: boolean | ReadonlySet<string> = false) {}
  async discoverModels(): Promise<string[]> {
    return ['deepseek-v4-flash', 'gpt-4o-describe'];
  }
  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: request.apiKey ? '[present]' : '' });
    const content = request.messages[0]?.content;
    const hasImagePart = Array.isArray(content) && content.some((part) => part.type === 'image');
    if (hasImagePart) {
      const failForModel =
        this.failVision === true ||
        (this.failVision instanceof Set && this.failVision.has(request.modelId));
      if (failForModel) {
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
  /** Present only with `bindWorkspace`; needed to address workspace attachments. */
  conversationId?: string;
}

async function setupFixture(options: {
  fallbackEnabled: boolean;
  modelId: string;
  bindWorkspace?: boolean;
  failVision?: boolean;
  failVisionModelIds?: string[];
  addBackupVisionModel?: boolean;
  failOcr?: boolean;
  /** 不写入任何探测结论，复现「探针在中转站上跑不通」的真实处境。 */
  skipVisionProbe?: boolean;
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
  const conversationStore = options.bindWorkspace
    ? new SqliteConversationStore(connection.raw)
    : undefined;
  let threadId = 'thread-vision';
  let workspaceRoot: string | undefined;
  let conversationId: string | undefined;
  if (workspaceStore) {
    workspaceRoot = join(dir, 'workspace');
    mkdirSync(workspaceRoot, { recursive: true });
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Vision OCR workspace',
      folderPath: workspaceRoot,
      allowedRoots: [workspaceRoot],
    });
    const task = workspaceStore.createTask({
      workspaceId,
      title: 'Vision OCR task',
      goal: 'Exercise image adaptation',
    });
    threadId = task.threadId;
    // The runtime only trusts workspace image paths inside the conversation's
    // own `.sync-think/conversations/<id>/images` directory, so the fixture has
    // to bind a conversation the same way the Desktop does.
    const conversation = conversationStore!.create({
      target: { track: 'model', modelId: 'deepseek-v4-flash' as ModelId },
      workspaceId,
      title: 'Vision OCR task',
    });
    conversationStore!.bindTask(conversation.id, task.taskId);
    conversationId = String(conversation.id);
  }
  const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
  const handle = await secureStore.storeSecret('sk-VISION_TEST_KEY');
  const created = providerStore.createProvider({
    name: 'Vision Gateway',
    baseUrl: 'https://vision.example/v1',
    protocol: 'openai-chat',
    storeHandle: handle,
  });
  const modelDefinitions = [
    { providerModelId: 'deepseek-v4-flash', displayName: 'DeepSeek Flash' },
    {
      providerModelId: 'gpt-4o-describe',
      displayName: 'GPT-4o Describe',
      capabilities: ['text', 'vision'],
    },
    ...(options.addBackupVisionModel
      ? [
          {
            providerModelId: 'gpt-4.1-backup',
            displayName: 'GPT-4.1 Backup',
            capabilities: ['text', 'vision'],
          },
        ]
      : []),
  ];
  const models = providerStore.upsertModels({
    providerId: created.provider.id,
    protocol: 'openai-chat',
    models: modelDefinitions,
  });
  const deepseekModel = models.find((model) => model.providerModelId === 'deepseek-v4-flash')!;
  const visionModel = models.find((model) => model.providerModelId === 'gpt-4o-describe')!;
  // 副模型必须**实测为正**才能进入 fallback 链路：`entryModelCapabilities`
  // 刻意忽略 `capabilities` 标签表，只认探测结论（`_visionCapability`）。旧版
  // 测试靠 `capabilities: ['text','vision']` 配置副模型，在能力探测对齐 NewMax
  // 之后整条链路恒不可用，四条断言因此长期红着。
  // `skipVisionProbe` 用来复现「探针在中转站上根本跑不通」的真实处境。
  if (!options.skipVisionProbe) {
    providerStore.updateModelVisionProbe({
      modelId: visionModel.id,
      result: true,
      reason: 'vision probe marker matched',
    });
    if (options.addBackupVisionModel) {
      const backupModel = models.find((model) => model.providerModelId === 'gpt-4.1-backup')!;
      providerStore.updateModelVisionProbe({
        modelId: backupModel.id,
        result: true,
        reason: 'vision probe marker matched',
      });
    }
  }
  // 设置里存的是**宿主**模型 id（桌面端副模型选择器写入 `model.modelId`），
  // 而 `decideCatalogVisionFallback` 正是按 `entry.modelId` 反查副模型条目。
  // 这里传进来的却是 provider-facing id，于是永远查不到条目、副模型恒为空 ——
  // 四条 fallback 断言因此长期红着，而不是链路本身坏了。
  const configuredVisionModel = models.find(
    (model) => model.id === options.modelId || model.providerModelId === options.modelId,
  );
  appSettingStore.set('vision-fallback', {
    enabled: options.fallbackEnabled,
    providerId: created.provider.id,
    modelId: configuredVisionModel?.id ?? options.modelId,
  });
  const adapter = new VisionRecordingAdapter(
    options.failVisionModelIds ? new Set(options.failVisionModelIds) : options.failVision,
  );
  const ocrPaths: string[] = [];
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    workspaceId,
    checkpointRunId,
    providerStore,
    workspaceStore,
    conversationStore,
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
    conversationId,
  };
}

async function openInbox(fixture: Fixture): Promise<{
  send: (frame: Frame) => Promise<Frame>;
  close: () => void;
}> {
  const socket = await connectRuntime(fixture.installId);
  const inbox = createFrameInbox(socket);
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
  return { send: inbox.send, close: () => socket.destroy() };
}

/** 用户在「能力」面板里确认标签集，可选带上手写的图片能力答案。 */
async function confirmVisionCapability(
  fixture: Fixture,
  modelId: string,
  override: boolean | null,
): Promise<Frame> {
  const { send, close } = await openInbox(fixture);
  try {
    return await send({
      id: 'confirm-vision',
      kind: 'request',
      type: 'provider.confirmCapabilities',
      payload: {
        modelId,
        capabilities: ['text', 'vision'],
        confirmed: true,
        visionCapabilityOverride: override,
      },
    });
  } finally {
    close();
  }
}

async function appendWithImages(
  fixture: Fixture,
  text: string,
  modelId: string,
  images: Array<{ name: string; mimeType: string; dataUrl?: string; stagingPath?: string }>,
): Promise<Frame> {
  const { send, close } = await openInbox(fixture);
  try {
    return await send({
      id: 'append',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: fixture.threadId,
        expectedTaskVersion: 0,
        role: 'user',
        text,
        modelId,
        images,
      },
    });
  } finally {
    close();
  }
}

async function appendImage(fixture: Fixture, text: string, modelId: string): Promise<Frame> {
  return appendWithImages(fixture, text, modelId, [
    {
      name: 'cat.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,QUJDRA==',
    },
  ]);
}

/**
 * Desktop writes pasted attachments into the workspace conversation directory
 * before dispatch and sends the absolute `stagingPath` (never the data URL), so
 * this reproduces the production shape for the `materialized` branch.
 */
async function appendStagedWorkspaceImage(
  fixture: Fixture,
  text: string,
  modelId: string,
): Promise<Frame> {
  if (!fixture.workspaceRoot || !fixture.conversationId) {
    throw new Error('appendStagedWorkspaceImage requires setupFixture({ bindWorkspace: true })');
  }
  const imageDir = join(
    fixture.workspaceRoot,
    '.sync-think',
    'conversations',
    fixture.conversationId,
    'images',
  );
  mkdirSync(imageDir, { recursive: true });
  const stagingPath = join(imageDir, 'attachment-1.png');
  writeFileSync(stagingPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return appendWithImages(fixture, text, modelId, [
    { name: 'cat.png', mimeType: 'image/png', stagingPath },
  ]);
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
      // 描述以 `injectDescriptionsIntoContent` 的 NewMax 版式注入
      // （`【图片 N · name】` 属于已被取代的 buildDescriptionSuffix）。
      expect(content as string).toContain('📷 图 1 描述：');
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

  it('forwards raw images when no workspace is bound and the Fallback switch is off', async () => {
    // 没有绑定工作区就没有可交给模型的相对路径，转发原图是仅剩的选项。
    // 这条契约由 ChatView 的 imagesMode 提示文案共同承担。
    const fixture = await setupFixture({ fallbackEnabled: false, modelId: 'gpt-4o-describe' });
    try {
      const append = await appendImage(fixture, '看图', fixture.deepseekModelId);
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
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('materializes workspace attachments for a text-only model instead of sending pixels', async () => {
    // 纯文本模型 + 没有可用副模型 + 已绑定工作区：原图不该发出去。
    // 系统提示词已经告诉模型「你不识图」，payload 里再塞原图，模型只能照
    // 提示词去跑 Windows OCR —— 这正是「发图片先 OCR」的来源。改成把附件
    // 落盘后的工作区相对路径交给模型，由它自己决定要不要调 ocr_image。
    const fixture = await setupFixture({
      fallbackEnabled: false,
      modelId: 'gpt-4o-describe',
      bindWorkspace: true,
    });
    try {
      const append = await appendStagedWorkspaceImage(
        fixture,
        '请读取截图',
        fixture.deepseekModelId,
      );
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('materialized');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fixture.adapter.calls).toHaveLength(1);
      // 关键不变量：没有自动 OCR，原图也没有进入 payload。
      expect(fixture.ocrPaths).toHaveLength(0);
      const content = fixture.adapter.calls[0]!.messages[0]!.content;
      expect(typeof content).toBe('string');
      expect(content as string).toContain(
        `.sync-think/conversations/${fixture.conversationId}/images/attachment-1.png`,
      );
      expect(content as string).toContain('ocr_image');
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('blocks the send when the configured vision model fails', async () => {
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      failVision: true,
    });
    try {
      const append = await appendImage(fixture, '请读取截图', fixture.deepseekModelId);
      expect(append.error).toBeDefined();
      expect(String(append.error?.message ?? append.error)).toContain('图片转写失败');
      expect(fixture.adapter.calls).toHaveLength(1);
      expect(fixture.adapter.calls[0]!.modelId).toBe('gpt-4o-describe');
      expect(fixture.ocrPaths).toHaveLength(0);
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('cannot use a vision fallback when the probe never produced a verdict', async () => {
    // 中转站不支持探针图时全库没有一条探测结论，副模型选不出来 —— 这正是
    // 「能力探测做不对」的实际处境。
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      skipVisionProbe: true,
    });
    try {
      const append = await appendImage(fixture, '看图', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('forwarded');
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('uses the vision fallback once the user answers the capability by hand', async () => {
    // 同一份目录、同样没有探测结论；用户在能力面板勾上「视觉」之后，副模型
    // 转写必须立刻可用 —— 这是探针跑不通时唯一能救回视觉链路的通道。
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      skipVisionProbe: true,
    });
    try {
      const confirmed = await confirmVisionCapability(fixture, fixture.visionModelId, true);
      expect(confirmed.error).toBeUndefined();
      expect(
        (confirmed.payload as { model?: { visionManualOverride?: boolean | null } }).model
          ?.visionManualOverride,
      ).toBe(true);

      const append = await appendImage(fixture, '看图', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('described');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // 描述调用用的是手写认定的那个模型。
      const describeCall = fixture.adapter.calls.find(
        (call) =>
          Array.isArray(call.messages[0]?.content) &&
          (call.messages[0]!.content as Array<{ type?: string }>).some(
            (part) => part.type === 'image',
          ),
      );
      expect(describeCall?.modelId).toBe('gpt-4o-describe');
      expect(fixture.ocrPaths).toHaveLength(0);
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('falls back to the probe verdict again when the manual answer is cleared', async () => {
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      skipVisionProbe: true,
    });
    try {
      await confirmVisionCapability(fixture, fixture.visionModelId, true);
      const cleared = await confirmVisionCapability(fixture, fixture.visionModelId, null);
      expect(
        (cleared.payload as { model?: { visionManualOverride?: boolean | null } }).model
          ?.visionManualOverride,
      ).toBeNull();

      const append = await appendImage(fixture, '看图', fixture.deepseekModelId);
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('forwarded');
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('tries the next verified vision candidate when the configured model fails', async () => {
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      addBackupVisionModel: true,
      failVisionModelIds: ['gpt-4o-describe'],
    });
    try {
      const append = await appendImage(fixture, '请读取截图', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('described');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const visionCalls = fixture.adapter.calls.filter(
        (call) =>
          Array.isArray(call.messages[0]?.content) &&
          (call.messages[0]!.content as Array<{ type?: string }>).some(
            (part) => part.type === 'image',
          ),
      );
      expect(visionCalls.map((call) => call.modelId)).toEqual([
        'gpt-4o-describe',
        'gpt-4.1-backup',
      ]);
      const mainCall = fixture.adapter.calls.at(-1)!;
      expect(typeof mainCall.messages[0]!.content).toBe('string');
      expect(mainCall.messages[0]!.content).toContain('一只坐在窗台上的猫');
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('forwards inline attachments that have no workspace path to materialize', async () => {
    // 桌面端在绑定工作区时一定会把附件落盘并传 `stagingPath`，所以这里是
    // 残留分支：附件只带内联 data URL（或只存在于共享 staging 目录）时，
    // runtime 拿不到可交给模型的相对路径，只能退回转发原图 —— 而不是把附件
    // 悄悄丢掉。materialized 的失败回退就靠这条兜底。
    const fixture = await setupFixture({
      fallbackEnabled: false,
      modelId: 'gpt-4o-describe',
      bindWorkspace: true,
    });
    try {
      const append = await appendImage(fixture, '请读取截图文字', fixture.deepseekModelId);
      expect(append.error).toBeUndefined();
      expect((append.payload as { imagesMode?: string }).imagesMode).toBe('forwarded');

      const deadline = Date.now() + 8_000;
      while (fixture.adapter.calls.length < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fixture.adapter.calls).toHaveLength(1);
      const content = fixture.adapter.calls[0]!.messages[0]!.content;
      expect(Array.isArray(content)).toBe(true);
      expect(fixture.ocrPaths).toHaveLength(0);
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('blocks the send when visual fallback fails and never forwards raw images', async () => {
    const fixture = await setupFixture({
      fallbackEnabled: true,
      modelId: 'gpt-4o-describe',
      failVision: true,
      failOcr: true,
    });
    try {
      const append = await appendImage(fixture, '请读取截图', fixture.deepseekModelId);
      expect(append.error).toBeDefined();
      expect(String(append.error?.message ?? append.error)).toContain('图片转写失败');
      expect(fixture.adapter.calls).toHaveLength(1);
      expect(fixture.ocrPaths).toHaveLength(0);
    } finally {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});
