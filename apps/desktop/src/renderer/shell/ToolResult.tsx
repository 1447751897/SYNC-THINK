/**
 * Be UI Tool Result local adaptation (MIT).
 * Copyright (c) 2026 Saurabh Chauhan. See third-party/beui-code-block.LICENSE.
 * ToolRow owns the single disclosure; this surface owns result status and output.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Ban, CircleCheck, CircleDashed, CircleX, LoaderCircle, Pause, RotateCcw, Shield } from 'lucide-react';
import { CodeBlock, type CodeBlockReadingState } from './CodeBlock.js';
import { languageFromPath } from './code-highlight.js';

export type ToolResultStatus = 'running' | 'success' | 'error' | 'cancelled' | 'paused' | 'waiting' | 'interrupted';
export interface ToolResultProps {
  output?: string;
  status: ToolResultStatus;
  kind?: 'terminal' | 'request' | 'custom' | 'file';
  filename?: string;
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
  filename,
  truncated,
  readingState,
  onRead,
  onRetry,
  testId,
}: ToolResultProps) {
  // Associate the raw selection with this payload so a new result opens in its
  // readable view rather than inheriting an earlier result's display choice.
  const [rawOutputSelection, setRawOutputSelection] = useState<string>();
  const { raw, file } = useMemo(() => {
    let code = output ?? '';
    let language = 'text';
    let parsed: unknown;
    if (/^[\s]*[\[{]/.test(code)) {
      try {
        parsed = JSON.parse(code);
        code = JSON.stringify(parsed, null, 2);
        language = 'json';
      } catch {
        /* Partial/plain output stays text. */
      }
    }
    const prepare = (source: string, syntax: string) => ({
      code: source,
      language: syntax,
      lines: source ? source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length : 0,
    });
    const raw = prepare(code, language);
    if (kind === 'file' && status === 'success' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const envelope = parsed as Record<string, unknown>;
      const source = typeof envelope.content === 'string' ? envelope.content : envelope.text;
      // Unwrap only a successful file-worker envelope. Never globally replace
      // escaped characters: literal backslashes inside file contents are data.
      if (envelope.ok === true && !envelope.error &&
          typeof envelope.bytes === 'number' && Number.isFinite(envelope.bytes) && envelope.bytes >= 0 &&
          typeof source === 'string') {
        const path = filename ?? (typeof envelope.path === 'string' ? envelope.path : undefined);
        return { raw, file: prepare(source, languageFromPath(path) ?? 'text') };
      }
    }
    return { raw, file: undefined };
  }, [output, kind, status, filename]);
  const showRaw = file !== undefined && rawOutputSelection === output;
  const content = file && !showRaw ? file : raw;
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
      {content.lines > 0 || file ? (
        <span className="shell-beui-result__meta" title={filename}>
          {file ? (showRaw ? '原始 JSON' : `文件内容 · ${content.language.toUpperCase()}`) :
            content.language === 'json' ? 'JSON' : kind === 'terminal' ? '终端输出' : '返回内容'} ·{' '}
          {content.lines} 行
        </span>
      ) : null}
      {file ? (
        <button
          type="button"
          className="shell-beui-result__mode"
          aria-pressed={showRaw}
          onClick={() => setRawOutputSelection(showRaw ? undefined : output)}
        >
          {showRaw ? '查看文件内容' : '查看原始结果'}
        </button>
      ) : null}
    </span>
  );
  return (
    <div
      className="shell-tool-result shell-beui-result"
      data-testid={testId}
      data-status={status}
      data-kind={kind}
      data-view={file && !showRaw ? 'file' : 'raw'}
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
          copyLabel={truncated ? '复制当前日志片段' : status === 'error' ? '复制错误' : file && !showRaw ? '复制文件内容' : '复制输出'}
        />
      ) : (
        <div className="shell-beui-result__empty">
          {identity}
          <p>
            {file && !showRaw
              ? '文件为空。'
              : status === 'running'
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
