/**
 * Conversation stream / empty observability — pure projection for thread column.
 * Soft only: does NOT close M1. Complements stream-status + empty-conversation UI.
 */
export type ConversationConnectionState = 'online' | 'connecting' | 'offline' | string;

export type ConversationStreamState =
  | 'idle'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | string;

export type ConversationReadinessLevel =
  | 'empty'
  | 'ready'
  | 'streaming'
  | 'failed'
  | 'paused'
  | 'partial';

/** Primary recovery action after a generation failure (soft · no M1 close). */
export type ConversationFailureCtaAction =
  | 'retry-compose'
  | 'jump-providers'
  | 'jump-agent'
  | 'jump-memory'
  | 'jump-trace'
  | 'reconnect'
  | 'none';

export type ConversationStreamFailureKind =
  | 'rate-limit'
  | 'auth'
  | 'timeout'
  | 'model-not-found'
  | 'network'
  | 'permission'
  | 'provider'
  | 'cancelled'
  | 'unknown';

export interface ConversationStreamFailureInfo {
  kind: ConversationStreamFailureKind;
  /** Stable machine code for data-failure-code (never secrets). */
  code: string;
  /** Short Chinese label for badge/subtitle. */
  hint: string;
  /** One-line recovery guidance. */
  recovery: string;
  ctaAction: ConversationFailureCtaAction;
  ctaLabel: string;
}

export interface ConversationStreamReadinessInput {
  connectionState: ConversationConnectionState;
  streamState: ConversationStreamState;
  hasActiveTask: boolean;
  messageCount: number;
  previewCount?: number;
  eventHistoryCount?: number;
  modelOptionCount?: number;
  multiProvider?: boolean;
  modelId?: string | null;
  errorSummary?: string | null;
  notice?: string | null;
  /** Last Runtime connect failure code (e.g. runtime.unavailable) */
  connectFailureCode?: string | null;
  /** Whether last connect failure was retryable */
  connectRetryable?: boolean | null;
}

export interface ConversationStreamCheck {
  id: string;
  label: string;
  detail: string;
  ok: '1' | '0' | 'partial';
}

export interface ConversationStreamReadiness {
  level: ConversationReadinessLevel;
  badge: string;
  title: string;
  subtitle: string;
  note: string;
  connectionOk: boolean;
  taskOk: boolean;
  hasMessages: boolean;
  streaming: boolean;
  failed: boolean;
  paused: boolean;
  cancelled: boolean;
  messageCount: number;
  modelOptionCount: number;
  checks: ConversationStreamCheck[];
  /** Manual reconnect CTA when Runtime is offline. */
  showReconnectCta: boolean;
  reconnectCtaLabel: string;
  reconnectCtaHint: string;
  /** Generation failure recovery CTA (online + stream failed). */
  showFailureCta: boolean;
  failureCtaLabel: string;
  failureCtaHint: string;
  failureCtaAction: ConversationFailureCtaAction;
  /** Classified failure (null when not failed). */
  failure: ConversationStreamFailureInfo | null;
  /** data-failure-code for observability (connect or stream). */
  failureCode: string | null;
}

function cnStateLabel(state: ConversationConnectionState): string {
  switch (state) {
    case 'online':
      return '在线';
    case 'connecting':
      return '连接中';
    case 'offline':
      return '离线';
    case 'preview':
      return '预览';
    default:
      return String(state);
  }
}

function streamLabel(state: ConversationStreamState): string {
  switch (state) {
    case 'idle':
      return '空闲';
    case 'streaming':
      return '生成中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'paused':
      return '已暂停';
    case 'cancelled':
      return '已取消';
    default:
      return String(state);
  }
}

function failureCodeHint(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'runtime.unavailable':
      return 'Runtime 进程不可用';
    case 'runtime.authentication-failed':
      return '认证失败';
    case 'runtime.protocol-error':
      return '协议错误';
    case 'runtime.permission-denied':
      return '权限不足';
    case 'runtime.request-rejected':
      return '请求被拒绝';
    case 'desktop.bridge-error':
      return '桌面桥接异常';
    default:
      return code;
  }
}

/**
 * Scrub accidental secret-looking tokens from error text before UI/tests.
 * Soft guard only — never store keys.
 */
export function scrubFailureText(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/\bsk-[A-Za-z0-9_\-]{8,}\b/g, 'sk-***');
  s = s.replace(/\bBearer\s+[A-Za-z0-9_\-\.]{12,}/gi, 'Bearer ***');
  s = s.replace(/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_\-]{8,}/gi, 'api_key=***');
  // collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // hard cap length for subtitle
  if (s.length > 160) s = s.slice(0, 157) + '…';
  return s;
}

/**
 * Classify generation / provider failure from free-text errorSummary.
 * Pure · deterministic · never claims M1 closed.
 */
export function classifyStreamFailure(
  errorSummary: string | null | undefined,
  opts?: { offline?: boolean; cancelled?: boolean },
): ConversationStreamFailureInfo {
  if (opts?.cancelled) {
    return {
      kind: 'cancelled',
      code: 'stream.cancelled',
      hint: '已取消',
      recovery: '可换模型后重新发送',
      ctaAction: 'retry-compose',
      ctaLabel: '准备重试发送',
    };
  }
  if (opts?.offline) {
    return {
      kind: 'network',
      code: 'runtime.offline',
      hint: 'Runtime 离线',
      recovery: '先重新连接 Runtime，再发送',
      ctaAction: 'reconnect',
      ctaLabel: '重新连接 Runtime',
    };
  }

  const raw = scrubFailureText(errorSummary);
  const lower = raw.toLowerCase();

  if (
    /429|rate[-_ ]?limit|too many requests|配额|限流|超速/.test(lower) ||
    /rate limit/i.test(raw)
  ) {
    return {
      kind: 'rate-limit',
      code: 'stream.rate-limit',
      hint: '限流 / 配额',
      recovery: '稍后再试，或切换 Fallback / 其他 Provider',
      ctaAction: 'jump-agent',
      ctaLabel: '查看 Fallback 链',
    };
  }

  if (
    /401|403|unauthorized|invalid.?api.?key|authentication|auth failed|凭证|密钥无效|未授权/.test(
      lower,
    )
  ) {
    return {
      kind: 'auth',
      code: 'stream.auth',
      hint: '鉴权失败',
      recovery: '检查 Provider 密钥（遮罩）与 baseURL；密钥勿入库',
      ctaAction: 'jump-providers',
      ctaLabel: '打开 Providers',
    };
  }

  if (/timeout|timed out|deadline|etimedout|超时/.test(lower)) {
    return {
      kind: 'timeout',
      code: 'stream.timeout',
      hint: '超时',
      recovery: '可缩短上下文或换更快模型后重试',
      ctaAction: 'jump-trace',
      ctaLabel: '查看轨迹',
    };
  }

  if (
    /model.?not.?found|unknown model|does not exist|无此模型|模型不存在|404.*model/.test(
      lower,
    )
  ) {
    return {
      kind: 'model-not-found',
      code: 'stream.model-not-found',
      hint: '模型不可用',
      recovery: '重新发现模型或改 Agent 默认 / 本轮覆盖',
      ctaAction: 'jump-providers',
      ctaLabel: '打开 Providers',
    };
  }

  if (
    /econnrefused|enotfound|network|fetch failed|socket|dns|连接失败|网络/.test(lower)
  ) {
    return {
      kind: 'network',
      code: 'stream.network',
      hint: '网络 / 端点',
      recovery: '检查 baseURL 可达性与本地代理；或换 Provider',
      ctaAction: 'jump-providers',
      ctaLabel: '打开 Providers',
    };
  }

  if (/permission|policy|denied|审批|权限/.test(lower)) {
    return {
      kind: 'permission',
      code: 'stream.permission',
      hint: '权限 / 策略',
      recovery: '到审批中心或 Memory/Diagnostics 查看可行动步骤',
      ctaAction: 'jump-memory',
      ctaLabel: '打开诊断',
    };
  }

  if (/provider|gateway|upstream|bad gateway|502|503|504/.test(lower)) {
    return {
      kind: 'provider',
      code: 'stream.provider',
      hint: '上游 Provider',
      recovery: '查看 Diagnostics 与 Fallback；可换模型重试',
      ctaAction: 'jump-agent',
      ctaLabel: '检查绑定 / Fallback',
    };
  }

  if (!raw) {
    return {
      kind: 'unknown',
      code: 'stream.failed',
      hint: '生成失败',
      recovery: '查看轨迹与诊断；可换模型或凭证后重试',
      ctaAction: 'jump-trace',
      ctaLabel: '查看轨迹',
    };
  }

  return {
    kind: 'unknown',
    code: 'stream.failed',
    hint: '生成失败',
    recovery: '查看轨迹/诊断 · 可换模型或凭证后重试',
    ctaAction: 'jump-trace',
    ctaLabel: '查看轨迹',
  };
}

export function projectConversationStreamReadiness(
  input: ConversationStreamReadinessInput,
): ConversationStreamReadiness {
  const connectionOk = input.connectionState === 'online';
  const taskOk = Boolean(input.hasActiveTask);
  const messageCount = Math.max(0, input.messageCount | 0);
  const previewCount = Math.max(0, (input.previewCount ?? 0) | 0);
  const eventHistoryCount = Math.max(0, (input.eventHistoryCount ?? 0) | 0);
  const modelOptionCount = Math.max(0, (input.modelOptionCount ?? 0) | 0);
  const hasMessages = messageCount + previewCount > 0;
  const streaming = input.streamState === 'streaming';
  const failed = input.streamState === 'failed';
  const paused = input.streamState === 'paused';
  const cancelled = input.streamState === 'cancelled';
  const offline = input.connectionState === 'offline';
  const connecting = input.connectionState === 'connecting';
  const connectHint = failureCodeHint(input.connectFailureCode ?? null);

  const streamFailure =
    failed || cancelled
      ? classifyStreamFailure(input.errorSummary, {
          offline,
          cancelled,
        })
      : offline
        ? classifyStreamFailure(input.errorSummary, { offline: true })
        : null;

  let level: ConversationReadinessLevel = 'empty';
  if (streaming) level = 'streaming';
  else if (failed) level = 'failed';
  else if (paused) level = 'paused';
  else if (cancelled) level = 'partial';
  else if (!connectionOk && !taskOk && !hasMessages) level = 'empty';
  else if (connectionOk && taskOk) level = hasMessages ? 'ready' : 'ready';
  else if (connectionOk || taskOk || hasMessages) level = 'partial';
  else level = 'empty';

  if (!streaming && !failed && !paused && !connectionOk && !taskOk && !hasMessages) {
    level = 'empty';
  }

  const badge =
    level === 'streaming'
      ? '生成中'
      : level === 'failed'
        ? streamFailure?.hint && streamFailure.kind !== 'unknown'
          ? streamFailure.hint
          : '失败'
        : level === 'paused'
          ? '已暂停'
          : cancelled
            ? '已取消'
            : offline
              ? '离线'
              : connecting
                ? '连接中'
                : level === 'ready'
                  ? taskOk
                    ? hasMessages
                      ? '对话中'
                      : '可开始'
                    : '已连接'
                  : level === 'partial'
                    ? '准备中'
                    : '等待';

  let title: string;
  if (streaming) title = '正在生成回复';
  else if (failed) {
    title = streamFailure
      ? `生成失败 · ${streamFailure.hint}`
      : '生成失败';
  } else if (paused) title = '生成已暂停';
  else if (cancelled) title = '生成已取消';
  else if (connecting) title = '正在从 Runtime 恢复事件流…';
  else if (offline)
    title = connectHint ? `Runtime 暂不可用 · ${connectHint}` : 'Runtime 暂不可用';
  else if (taskOk && !hasMessages) title = '从下方输入开始这条连续对话';
  else if (taskOk && hasMessages) title = '连续对话进行中';
  else title = '左侧新建项目，再创建或打开任务';

  const scrubbedError = scrubFailureText(input.errorSummary);
  const bits: string[] = [];
  if (taskOk) bits.push('任务已打开');
  else bits.push('尚未打开任务');
  bits.push(`Runtime ${cnStateLabel(input.connectionState)}`);
  bits.push(`Run · ${streamLabel(input.streamState)}`);
  if (input.modelId) bits.push(String(input.modelId));
  if (hasMessages) bits.push(`消息 ${messageCount + previewCount}`);
  if (failed && streamFailure) {
    bits.push(streamFailure.hint);
    if (scrubbedError) bits.push(scrubbedError);
  } else if (scrubbedError) bits.push(scrubbedError);
  else if (connectHint && offline) bits.push(connectHint);
  else if (input.notice) bits.push(String(input.notice));
  if (input.connectFailureCode && offline) bits.push(String(input.connectFailureCode));
  if (failed && streamFailure) bits.push(streamFailure.code);
  const subtitle = bits.join(' · ');

  const notes: string[] = [];
  if (streaming) notes.push('Esc 可取消流式 · 轨迹与 Manifest 同步写入');
  else if (failed && streamFailure) {
    notes.push(streamFailure.recovery);
    notes.push('轨迹与 Diagnostics 可对照 · soft 可观测 ≠ 关 M1');
  } else if (failed) notes.push('查看轨迹/诊断 · 可换模型或凭证后重试');
  else if (paused) notes.push('可恢复或取消 · 历史与密钥仍在本地 Runtime');
  else if (cancelled) notes.push('已取消本轮 · 历史保留 · 可换模型再发');
  else if (connecting) notes.push('首次/重连自动重试中 · 成功后会 catch-up 事件');
  else if (offline) {
    notes.push('点「重新连接 Runtime」可手动重试');
    if (input.connectRetryable === false) {
      notes.push('上次失败标记为不可自动重试，手动仍可再试');
    } else {
      notes.push('恢复后会自动重订事件与 catch-up');
    }
  } else if (!taskOk) notes.push('打开任务后可发送；重启仍从同一 thread 接续');
  else if (!hasMessages) notes.push('发送后交错恢复历史 · 流式/轨迹/Fallback 可观测');
  else notes.push('完整历史按任务 thread 恢复 · soft 可观测 ≠ 关 M1');

  const checks: ConversationStreamCheck[] = [
    {
      id: 'runtime',
      label: 'Runtime',
      detail:
        offline && connectHint
          ? `${cnStateLabel(input.connectionState)} · ${connectHint}`
          : cnStateLabel(input.connectionState),
      ok: connectionOk ? '1' : connecting ? 'partial' : '0',
    },
    {
      id: 'task',
      label: '任务',
      detail: taskOk ? '已打开' : '未打开',
      ok: taskOk ? '1' : '0',
    },
    {
      id: 'stream',
      label: 'Run',
      detail:
        failed && streamFailure
          ? `${streamLabel(input.streamState)} · ${streamFailure.hint}`
          : streamLabel(input.streamState),
      ok: streaming ? '1' : failed ? '0' : paused || cancelled ? 'partial' : connectionOk ? '1' : '0',
    },
    {
      id: 'messages',
      label: '消息',
      detail: hasMessages
        ? `${messageCount + previewCount} 条`
        : eventHistoryCount > 0
          ? `历史事件 ${eventHistoryCount}`
          : '尚无',
      ok: hasMessages ? '1' : eventHistoryCount > 0 ? 'partial' : '0',
    },
    {
      id: 'models',
      label: '模型',
      detail: modelOptionCount > 0 ? `${modelOptionCount} 可选` : '未注册',
      ok: modelOptionCount > 0 ? '1' : '0',
    },
    {
      id: 'multi',
      label: '跨 Provider',
      detail: input.multiProvider ? '是' : '否',
      ok: input.multiProvider ? '1' : '0',
    },
  ];

  const showReconnectCta = offline;
  const reconnectCtaLabel = connecting
    ? '连接中…'
    : input.connectRetryable === false
      ? '仍要重试连接'
      : '重新连接 Runtime';
  const reconnectCtaHint = offline
    ? connectHint
      ? `上次：${connectHint}${input.connectFailureCode ? ` (${input.connectFailureCode})` : ''}`
      : '取消在途重试并重新建立事件流'
    : '';

  // Failure recovery CTA: generation failed while online (or cancelled with guidance)
  const showFailureCta =
    !offline &&
    (failed || cancelled) &&
    streamFailure != null &&
    streamFailure.ctaAction !== 'none';
  const failureCtaLabel = showFailureCta ? streamFailure!.ctaLabel : '';
  const failureCtaHint = showFailureCta
    ? `${streamFailure!.recovery}${scrubbedError ? ' · ' + scrubbedError : ''}`
    : '';
  const failureCtaAction: ConversationFailureCtaAction = showFailureCta
    ? streamFailure!.ctaAction
    : 'none';

  const failureCode = offline
    ? input.connectFailureCode ?? (streamFailure ? streamFailure.code : null)
    : failed || cancelled
      ? streamFailure?.code ?? null
      : null;

  return {
    level,
    badge,
    title,
    subtitle,
    note: notes.join(' · '),
    connectionOk,
    taskOk,
    hasMessages,
    streaming,
    failed,
    paused,
    cancelled,
    messageCount: messageCount + previewCount,
    modelOptionCount,
    checks,
    showReconnectCta,
    reconnectCtaLabel,
    reconnectCtaHint,
    showFailureCta,
    failureCtaLabel,
    failureCtaHint,
    failureCtaAction,
    failure: failed || cancelled ? streamFailure : null,
    failureCode,
  };
}
