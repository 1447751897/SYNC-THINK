import { scrubFailureText } from './conversation-stream-readiness.js';

export interface AppendMessageFailure {
  readonly message: string;
  readonly connectionLost: boolean;
  readonly versionMismatch: boolean;
}

function unwrapRuntimeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return raw
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^Runtime(?:Transient|Response)Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}

export function classifyAppendMessageFailure(error: unknown): AppendMessageFailure {
  const detail = scrubFailureText(unwrapRuntimeError(error));
  const versionMismatch =
    /task\.version_mismatch/i.test(detail) ||
    /Expected task version \d+, received \d+/i.test(detail);
  if (versionMismatch) {
    return {
      message: '任务消息版本已更新，请重新发送。任务状态会自动同步。',
      connectionLost: false,
      versionMismatch: true,
    };
  }

  const timeout = detail.match(/^Runtime request timed out:\s*(.+)$/i);
  if (timeout) {
    return {
      message:
        timeout[1].trim() === 'task.appendMessage'
          ? '发送超时。如果这条消息带了图片，可能卡在识图上了，请稍后重试或先去掉附件。'
          : '发送超时，请稍后重试。',
      connectionLost: false,
      versionMismatch: false,
    };
  }

  const connectionLost =
    /runtime connection.*(?:unavailable|closed)/i.test(detail) ||
    /ECONNRESET|ECONNREFUSED|EPIPE|ENOENT|IPC channel is closed|object has been destroyed/i.test(
      detail,
    );
  if (connectionLost) {
    return {
      message: 'Runtime 连接中断，请重新连接后发送。',
      connectionLost: true,
      versionMismatch: false,
    };
  }

  return {
    message: detail ? `发送失败: ${detail}` : '发送失败，请重试。',
    connectionLost: false,
    versionMismatch: false,
  };
}
