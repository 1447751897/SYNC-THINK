/** Compact BoardUI AgentThinking infinity variant, without a sidebar timer. */
const INFINITY_PATH =
  'M28 14C33 5 47 5 47 14C47 23 33 23 28 14C23 5 9 5 9 14C9 23 23 23 28 14Z';

export function SidebarThinkingIndicator({ conversationId }: { conversationId: string }) {
  return (
    <span
      className="sidebar-thinking-indicator"
      data-testid={`conversation-thinking-${conversationId}`}
      role="status"
      aria-label="正在运行"
      title="正在运行"
    >
      <svg viewBox="0 0 56 28" aria-hidden="true" className="sidebar-thinking-indicator__shape">
        <path d={INFINITY_PATH} fill="none" stroke="currentColor" strokeWidth={2.75} opacity={0.15} />
        <path
          d={INFINITY_PATH}
          pathLength={100}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.75}
          strokeLinecap="round"
          strokeDasharray="11 89"
          className="sidebar-thinking-indicator__comet"
        />
      </svg>
    </span>
  );
}
