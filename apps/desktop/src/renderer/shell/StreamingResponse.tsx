/**
 * Be UI Streaming Response local adaptation (MIT).
 * Copyright (c) 2026 Saurabh Chauhan. See third-party/beui-code-block.LICENSE.
 * Keeps the existing incremental Markdown tree mounted as response state changes.
 */
import type { ReactNode } from 'react';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { CitationScope } from './CitationContext.js';
import {
  Check,
  Copy,
  LoaderCircle,
  RotateCcw,
  SendHorizonal,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { AnswerSources } from './AnswerSources.js';
import type { AnswerSource } from './answer-sources.js';

const NO_CITATION_SOURCES: readonly AnswerSource[] = [];

export type StreamingResponseStatus =
  'streaming' | 'complete' | 'error' | 'cancelled' | 'paused' | 'waiting';
export type ResponseCopyState = 'idle' | 'copying' | 'copied' | 'error';
export type ResponseFeedback = 'up' | 'down' | null;

export function responseStatus(input: {
  streaming?: boolean;
  waitingForApproval?: boolean;
  terminalState?: 'failed' | 'cancelled' | 'paused';
}): StreamingResponseStatus {
  if (input.terminalState === 'failed') return 'error';
  if (input.terminalState) return input.terminalState;
  if (input.waitingForApproval) return 'waiting';
  return input.streaming ? 'streaming' : 'complete';
}

function ResponseAction({
  label,
  active,
  busy,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="shell-response__action"
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function StreamingResponse({
  children,
  status,
  variant = 'plain',
  notice,
  metadata,
  sources = NO_CITATION_SOURCES,
  showActions = true,
  copyState = 'idle',
  onCopy,
  onRetry,
  onContinue,
  busy = false,
  feedback = null,
  onFeedbackChange,
  onOpenFile,
  onOpenUrl,
}: {
  children?: ReactNode;
  status: StreamingResponseStatus;
  variant?: 'plain' | 'bubble';
  notice?: ReactNode;
  metadata?: ReactNode;
  sources?: readonly AnswerSource[];
  showActions?: boolean;
  copyState?: ResponseCopyState;
  onCopy?: () => void;
  onRetry?: () => void;
  onContinue?: () => void;
  busy?: boolean;
  feedback?: ResponseFeedback;
  onFeedbackChange?: (feedback: ResponseFeedback) => void;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const active = status === 'streaming' || status === 'waiting';
  const complete = status === 'complete';
  const canContinue = (status === 'cancelled' || status === 'paused') && onContinue;
  const showFeedback = complete && Boolean(onFeedbackChange);
  const showFooter =
    !active &&
    (Boolean(metadata) ||
      (showActions && Boolean(onCopy || onRetry || canContinue || showFeedback || sources.length)));
  const copyLabel =
    copyState === 'copying'
      ? '读取原文中'
      : copyState === 'copied'
        ? '已复制'
        : copyState === 'error'
          ? '重试复制'
          : '复制';
  const statusLabel =
    status === 'streaming'
      ? '正在生成回答'
      : status === 'waiting'
        ? '等待审批'
        : complete
          ? '回答已完成'
          : status === 'error'
            ? '回答失败'
            : status === 'paused'
              ? '回答已暂停'
              : '已停止生成';
  return (
    <CitationScope sources={!active && showActions ? sources : NO_CITATION_SOURCES}>
      <div
        className="shell-streaming-response"
        data-testid="streaming-response"
        data-state={status}
        data-variant={variant}
      >
        <span
          className="shell-response__announcement"
          role="status"
          aria-label="回答生成状态"
          aria-live="polite"
          aria-atomic="true"
        >
          {statusLabel}
        </span>
        <div className="shell-response__content" aria-busy={status === 'streaming'}>
          {children}
        </div>
        {notice ? <div className="shell-response__notice">{notice}</div> : null}
        {showFooter ? (
          <div className="shell-msg-footer shell-response__footer" data-testid="response-footer">
            {showActions ? (
              <div className="shell-response__controls">
                {copyState === 'error' ? (
                  <span className="shell-response__copy-error" role="alert">
                    读取或复制失败，请重试
                  </span>
                ) : null}
                <AnswerSources
                  sources={sources}
                  onOpenFile={onOpenFile}
                  onOpenUrl={onOpenUrl}
                  actions={
                    <>
                      {onCopy ? (
                        <ResponseAction
                          label={copyLabel}
                          busy={copyState === 'copying'}
                          disabled={copyState === 'copying'}
                          onClick={onCopy}
                        >
                          {copyState === 'copying' ? (
                            <LoaderCircle size={14} className="shell-response__spinner" />
                          ) : copyState === 'copied' ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </ResponseAction>
                      ) : null}
                      {canContinue ? (
                        <ResponseAction label="继续回答" disabled={busy} onClick={canContinue}>
                          <SendHorizonal size={14} />
                        </ResponseAction>
                      ) : null}
                      {onRetry ? (
                        <ResponseAction
                          label={complete ? '重新生成' : '重试回答'}
                          disabled={busy}
                          busy={busy}
                          onClick={onRetry}
                        >
                          <RotateCcw
                            size={14}
                            className={busy ? 'shell-response__spinner' : undefined}
                          />
                        </ResponseAction>
                      ) : null}
                      {showFeedback ? (
                        <>
                          <ResponseAction
                            label="有帮助"
                            active={feedback === 'up'}
                            onClick={() => onFeedbackChange?.(feedback === 'up' ? null : 'up')}
                          >
                            <ThumbsUp size={14} />
                          </ResponseAction>
                          <ResponseAction
                            label="没有帮助"
                            active={feedback === 'down'}
                            onClick={() => onFeedbackChange?.(feedback === 'down' ? null : 'down')}
                          >
                            <ThumbsDown size={14} />
                          </ResponseAction>
                        </>
                      ) : null}
                    </>
                  }
                />
              </div>
            ) : null}
            {metadata}
          </div>
        ) : null}
      </div>
    </CitationScope>
  );
}
