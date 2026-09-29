import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';

/** A compact live identity, with the real trace available on demand. */
export function AgentExecutionStatus({ name, avatar, running, waiting, failed, label, hasDetails = true, children }: { name: string; avatar?: string; running?: boolean; waiting?: boolean; failed?: boolean; label?: string; hasDetails?: boolean; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (expanded) detailsRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [expanded]);
  const text = label ?? (waiting ? '等待你确认' : failed ? '执行遇到问题' : running ? '思考中…' : '查看执行详情');
  if (!running && !waiting && !failed && !hasDetails) return null;
  return <div className="aw-execution" data-testid="agent-execution-status" data-running={running ? 'true' : 'false'}>
    <button type="button" className="aw-execution__summary" aria-label={name + ' · ' + text} aria-expanded={hasDetails ? expanded : undefined} disabled={!hasDetails} onClick={() => setExpanded(value => !value)}>
      <AgentWorkspaceAvatar name={name} avatar={avatar} size={24} animate={Boolean(running)} state={waiting ? 'worried' : failed ? 'error' : running ? 'thinking' : 'idle'} />
      <span className={running && !waiting ? 'shell-text-shimmer' : undefined} data-label={text}>{text}</span>{hasDetails && <ChevronDown size={12} className={expanded ? 'is-open' : ''} />}
    </button>
    {expanded && hasDetails && <div ref={detailsRef} className="aw-execution__details">{children}</div>}
  </div>;
}
