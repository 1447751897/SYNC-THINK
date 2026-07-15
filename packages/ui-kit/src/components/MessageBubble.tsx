import type { CSSProperties, ReactNode } from 'react';
import {
  Bot,
  BrainCircuit,
  Code2,
  Image as ImageIcon,
  ListChecks,
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
  agentColor?: string;
  onAgentActivate?: () => void;
  children?: ReactNode;
  /** @deprecated Internal model/run metadata belongs in Trace and Manifest. */
  meta?: string;
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
  const identityContents = showsAgent ? (
    <>
      <span
        className="st-message-bubble__avatar"
        data-testid="message-agent-avatar"
        data-icon={props.agentIcon?.trim() || 'bot'}
        data-streaming={props.streaming ? '1' : '0'}
        style={{ '--st-message-agent-color': agentColor } as CSSProperties}
      >
        <AgentGlyph icon={props.agentIcon} label={agentLabel} />
        {props.streaming ? (
          <span className="st-message-bubble__avatar-status" aria-hidden="true" />
        ) : null}
      </span>
      <span className="st-message-bubble__agent-copy">
        <strong>{agentLabel}</strong>
        {props.streaming ? <small>正在回复</small> : null}
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
      <div className="st-message-bubble__body" data-format={renderMarkdown ? 'markdown' : 'plain'}>
        {renderMarkdown ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.children as string}</ReactMarkdown>
        ) : (
          props.children
        )}
        {props.streaming ? <span className="st-message-bubble__cursor" aria-hidden="true" /> : null}
      </div>
    </article>
  );
}
