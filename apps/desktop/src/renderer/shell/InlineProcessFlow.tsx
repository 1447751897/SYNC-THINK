/**
 * DSH-style inline execution process for an assistant message.
 *
 * Renders the ordered process items (reasoning / commentary / intermediate
 * text / paired tool cards) directly in the message flow, so the user sees
 * 思考 → 摘要 → 工具 → … exactly as the model produced them. The final
 * answer is rendered separately by the message bubble.
 */
import { memo, useState } from 'react';
import { Brain, ChevronDown, CircleAlert, Wrench } from 'lucide-react';
import type { InlineProcessItem } from './ChatView.js';
import { MarkdownContent } from './MarkdownContent.js';

/** First non-empty line of a multi-line text (the collapsed Think-row summary). */
function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim() !== '');
  return line?.trim() ?? '';
}

/** Last non-empty line while streaming (the running summary stays current). */
function latestLine(text: string): string {
  const lines = text.split('\n').filter((part) => part.trim() !== '');
  return lines.at(-1)?.trim() ?? '';
}

function ThinkRow({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = streaming ? latestLine(text) : firstLine(text);
  return (
    <div className="shell-inline-process__think" data-testid="inline-process-reasoning">
      <button
        type="button"
        className="shell-inline-process__think-toggle"
        data-testid="think-row-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Brain size={12} aria-hidden="true" />
        <span className="shell-inline-process__think-label">思考</span>
        <span className="shell-inline-process__think-summary" data-testid="think-row-summary">
          {summary}
        </span>
        <ChevronDown
          size={13}
          className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-inline-process__think-body" data-testid="think-row-body">
          <MarkdownContent text={text} streaming={Boolean(streaming)} />
        </div>
      ) : null}
    </div>
  );
}

function ToolCard({ item }: { item: Extract<InlineProcessItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`shell-inline-process__tool${item.failed ? ' is-failed' : ''}`}
      data-testid="inline-process-tool"
      data-failed={item.failed ? 'true' : 'false'}
    >
      <button
        type="button"
        className="shell-inline-process__tool-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Wrench size={12} aria-hidden="true" />
        <span className="shell-inline-process__tool-name">{item.name}</span>
        {item.failed ? (
          <CircleAlert size={12} className="shell-inline-process__tool-failed-icon" aria-hidden="true" />
        ) : null}
        <span className="shell-inline-process__tool-status">
          {item.failed ? '失败' : item.result !== undefined ? '完成' : '执行中'}
        </span>
        <ChevronDown
          size={13}
          className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-inline-process__tool-body">
          {item.argumentsJson ? (
            <pre className="shell-inline-process__tool-code">{item.argumentsJson}</pre>
          ) : null}
          {item.result !== undefined ? (
            <pre
              className={`shell-inline-process__tool-code${item.failed ? ' is-failed' : ''}`}
              data-testid="inline-process-tool-result"
            >
              {item.result}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProcessItemView({
  item,
  streaming,
}: {
  item: InlineProcessItem;
  streaming?: boolean;
}) {
  switch (item.kind) {
    case 'reasoning':
      return <ThinkRow text={item.text} streaming={streaming} />;
    case 'text':
      return (
        <div className="shell-inline-process__text" data-testid="inline-process-text">
          <MarkdownContent text={item.text} streaming={Boolean(streaming)} />
        </div>
      );
    case 'commentary':
      return (
        <div className="shell-inline-process__commentary" data-testid="inline-process-commentary">
          <MarkdownContent text={item.text} streaming={Boolean(streaming)} />
        </div>
      );
    case 'tool':
      return <ToolCard item={item} />;
    default:
      return null;
  }
}

export const InlineProcessFlow = memo(function InlineProcessFlow({
  items,
  streaming,
}: {
  items: readonly InlineProcessItem[];
  streaming?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="shell-inline-process" data-testid="inline-process-flow">
      {items.map((item, index) => (
        <ProcessItemView key={`${item.kind}-${index}`} item={item} streaming={streaming} />
      ))}
    </div>
  );
});
