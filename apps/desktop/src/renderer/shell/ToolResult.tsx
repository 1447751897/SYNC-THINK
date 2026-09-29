/**
 * Be UI Tool Result local adaptation (MIT).
 * Copyright (c) 2026 Saurabh Chauhan. See third-party/beui-code-block.LICENSE.
 * ToolRow owns the single disclosure; this surface owns result status and output.
 */
import { useMemo, type ReactNode } from 'react';
import { Ban, CircleCheck, CircleDashed, CircleX, LoaderCircle, Pause, RotateCcw, Shield } from 'lucide-react';
import { CodeBlock, type CodeBlockReadingState } from './CodeBlock.js';

export type ToolResultStatus = 'running' | 'success' | 'error' | 'cancelled' | 'paused' | 'waiting' | 'interrupted';
export interface ToolResultProps {
  output?: string;
  status: ToolResultStatus;
  kind?: 'terminal' | 'request' | 'custom';
  truncated?: boolean;
  readingState?: CodeBlockReadingState;
  onRead?: () => void;
  /** Only supplied when a caller has a real supported retry operation. */
  onRetry?: () => void;
  testId?: string;
}
const STATUS_LABEL: Record<ToolResultStatus, string> = {
  running: '执行中',
  success: '已完成',
  error: '执行失败',
  cancelled: '已取消',
  paused: '已暂停',
  waiting: '等待批准',
  interrupted: '未收到完成结果',
};

export function ToolResult({
  output,
  status,
  kind = 'custom',
  truncated,
  readingState,
  onRead,
  onRetry,
  testId,
}: ToolResultProps) {
  const content = useMemo(() => {
    if (!output) return { code: '', language: 'text', lines: 0 };
    let code = output;
    let language = 'text';
    if (kind !== 'terminal' && /^[\s]*[\[{]/.test(output)) {
      try {
        code = JSON.stringify(JSON.parse(output), null, 2);
        language = 'json';
      } catch {
        /* Partial/plain output stays text. */
      }
    }
    return {
      code,
      language,
      lines: code.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length,
    };
  }, [output, kind]);
  const Icon =
    status === 'running'
      ? LoaderCircle
      : status === 'error'
        ? CircleX
        : status === 'cancelled'
          ? Ban
          : status === 'paused' ? Pause : status === 'waiting' ? Shield : status === 'interrupted' ? CircleDashed : CircleCheck;
  const identity: ReactNode = (
    <span className="shell-beui-result__identity">
      <span className="shell-beui-result__status" role="status" aria-live="polite">
        <Icon
          size={13}
          aria-hidden="true"
          className={status === 'running' ? 'shell-beui-result__spinner' : undefined}
        />
        {STATUS_LABEL[status]}
      </span>
      {content.lines > 0 ? (
        <span className="shell-beui-result__meta">
          {content.language === 'json' ? 'JSON' : kind === 'terminal' ? '终端输出' : '返回内容'} ·{' '}
          {content.lines} 行
        </span>
      ) : null}
    </span>
  );
  return (
    <div
      className="shell-tool-result shell-beui-result"
      data-testid={testId}
      data-status={status}
      data-kind={kind}
      aria-busy={status === 'running'}
      onPointerDownCapture={() => onRead?.()}
      onWheelCapture={(event) => {
        if (event.deltaY < 0) onRead?.();
      }}
      onKeyDownCapture={(event) => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) onRead?.();
      }}
    >
      {content.code ? (
        <CodeBlock
          code={content.code}
          language={content.language}
          streaming={status === 'running'}
          showStatus={false}
          identity={identity}
          collapsible={false}
          maxHeight={240}
          readingState={readingState}
          wrapControl
          copyLabel={truncated ? '复制当前日志片段' : status === 'error' ? '复制错误' : '复制输出'}
        />
      ) : (
        <div className="shell-beui-result__empty">
          {identity}
          <p>
            {status === 'running'
              ? '等待工具返回输出…'
              : status === 'error'
                ? '工具未返回错误详情'
                : status === 'cancelled'
                  ? '执行已取消'
                  : status === 'paused' ? '运行已暂停，保留已收到的输出。'
                    : status === 'waiting' ? '批准后继续执行。'
                    : status === 'interrupted' ? '运行已结束；此工具没有返回完成记录。'
                    : '执行完成，没有文本输出。'}
          </p>
        </div>
      )}
      {truncated ? (
        <p className="shell-beui-result__notice">{status === 'running' || status === 'paused' || status === 'waiting'
          ? '仅显示最近的日志；执行结束后查看最终输出。'
          : '仅保留最近收到的日志片段。'}</p>
      ) : null}
      {status === 'error' && onRetry ? (
        <button type="button" className="shell-beui-result__retry" onClick={onRetry}>
          <RotateCcw size={12} aria-hidden="true" />
          重新执行
        </button>
      ) : null}
    </div>
  );
}
