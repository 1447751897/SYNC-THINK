import type { CSSProperties, ReactNode } from 'react';
import {
  Bot,
  BrainCircuit,
  Code2,
  Image as ImageIcon,
  ListChecks,
  LoaderCircle,
  SearchCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// MessageBubble: user turns stay compact on the right; assistant turns expose
// the producing Agent as a stable teammate identity in the left gutter.
// layout=single: full-width single column (Locked IA: single-column option).
export interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  agentLabel?: string;
  agentIcon?: string;
  agentAvatarUrl?: string;
  agentColor?: string;
  onAgentActivate?: () => void;
  children?: ReactNode;
  /** @deprecated Internal model/run metadata belongs in Trace and Manifest. */
  meta?: string;
  /** Exact model recorded for this assistant turn. */
  modelLabel?: string;
  /** User-facing time for the persisted message. */
  occurredAt?: string;
  /** Token metadata only when recorded by the Runtime. */
  tokenLabel?: string;
  /** Effective routed target shown as an @ mention in the conversation. */
  mentionLabel?: string;
  /** Live stream indicator for in-flight assistant turns. */
  streaming?: boolean;
  /**
   * Conversation density layout.
   * - default: user right / agent left (split)
   * - single: full-width single column for long reading
   */
  layout?: 'default' | 'single';
}

const AGENT_ICON_MAP: Record<string, LucideIcon> = {
  agent: Bot,
  bot: Bot,
  brain: BrainCircuit,
  code: Code2,
  executor: Code2,
  image: ImageIcon,
  plan: ListChecks,
  planner: ListChecks,
  review: SearchCheck,
  reviewer: SearchCheck,
  workflow: Workflow,
};

function safeAgentColor(value: string | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#64748b';
}

function AgentGlyph({ icon, label }: { icon: string | undefined; label: string }) {
  const normalized = icon?.trim().toLowerCase() ?? '';
  const Icon = AGENT_ICON_MAP[normalized];
  if (Icon) return <Icon size={16} strokeWidth={1.9} aria-hidden="true" />;

  const raw = icon?.trim() ?? '';
  if (raw && raw.length <= 4 && !/^[a-z0-9_-]+$/i.test(raw)) {
    return <span aria-hidden="true">{raw}</span>;
  }

  return <span aria-hidden="true">{label.trim().slice(0, 1).toUpperCase() || 'A'}</span>;
}

export function MessageBubble(props: MessageBubbleProps) {
  const layout = props.layout === 'single' ? 'single' : 'default';
  const renderMarkdown = props.role === 'assistant' && typeof props.children === 'string';
  const showsAgent = props.role === 'assistant';
  const agentLabel = props.agentLabel?.trim() || 'Agent';
  const agentColor = safeAgentColor(props.agentColor);
  const hasMessageContent =
    typeof props.children === 'string'
      ? props.children.trim().length > 0
      : props.children !== null && props.children !== undefined && props.children !== false;
  const thinking = showsAgent && Boolean(props.streaming) && !hasMessageContent;
  const identityContents = showsAgent ? (
    <>
      <span
        className="st-message-bubble__avatar"
        data-testid="message-agent-avatar"
        data-icon={props.agentIcon?.trim() || 'bot'}
        data-streaming={props.streaming ? '1' : '0'}
        style={{ '--st-message-agent-color': agentColor } as CSSProperties}
      >
        {props.agentAvatarUrl ? (
          <img src={props.agentAvatarUrl} alt="" />
        ) : (
          <AgentGlyph icon={props.agentIcon} label={agentLabel} />
        )}
        {props.streaming ? (
          <span className="st-message-bubble__avatar-status" aria-hidden="true" />
        ) : null}
      </span>
      <span className="st-message-bubble__agent-copy">
        <strong>{agentLabel}</strong>
        {props.modelLabel || props.occurredAt || props.tokenLabel ? (
          <span className="st-message-bubble__agent-meta" data-testid="message-agent-meta">
            {props.modelLabel ? <span>{props.modelLabel}</span> : null}
            {props.occurredAt ? <time>{props.occurredAt}</time> : null}
            {props.tokenLabel ? <span>{props.tokenLabel}</span> : null}
          </span>
        ) : null}
        {props.streaming && !thinking ? <small>输出中</small> : null}
      </span>
    </>
  ) : null;

  return (
    <article
      className="st-message-bubble"
      data-role={props.role}
      data-layout={layout}
      data-streaming={props.streaming ? '1' : '0'}
      data-has-agent={showsAgent ? '1' : '0'}
      data-testid="message-bubble"
      aria-label={
        props.streaming
          ? props.agentLabel
            ? `${agentLabel} · 流式输出中`
            : '助手消息 · 流式输出中'
          : props.role === 'assistant'
            ? props.agentLabel
              ? `${agentLabel} 回复`
              : '助手消息'
            : props.role === 'user'
              ? '用户消息'
              : props.role === 'system'
                ? '系统消息'
                : props.role === 'tool'
                  ? '工具消息'
                  : `${props.role} 消息`
      }
    >
      {showsAgent ? (
        props.onAgentActivate ? (
          <button
            type="button"
            className="st-message-bubble__identity st-message-bubble__identity--button"
            data-testid="message-agent-identity"
            aria-label={`打开智能体：${agentLabel}`}
            onClick={props.onAgentActivate}
          >
            {identityContents}
          </button>
        ) : (
          <div
            className="st-message-bubble__identity"
            data-testid="message-agent-identity"
            aria-label={`智能体：${agentLabel}`}
          >
            {identityContents}
          </div>
        )
      ) : null}
      <div
        className="st-message-bubble__body"
        data-format={renderMarkdown ? 'markdown' : 'plain'}
        data-state={thinking ? 'thinking' : 'message'}
      >
        {props.mentionLabel ? (
          <span className="st-message-bubble__mention" data-testid="message-mention">
            @{props.mentionLabel}
          </span>
        ) : null}
        {thinking ? (
          <span className="st-message-bubble__thinking" data-testid="message-thinking">
            <LoaderCircle aria-hidden="true" size={14} />
            <span>{agentLabel} 正在思考...</span>
          </span>
        ) : renderMarkdown ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.children as string}</ReactMarkdown>
        ) : (
          props.children
        )}
        {props.streaming && !thinking ? (
          <span className="st-message-bubble__cursor" aria-hidden="true" />
        ) : null}
      </div>
      {!showsAgent && props.occurredAt ? (
        <time className="st-message-bubble__user-time">{props.occurredAt}</time>
      ) : null}
    </article>
  );
}
