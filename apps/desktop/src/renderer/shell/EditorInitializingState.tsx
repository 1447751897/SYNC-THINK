import { useEffect, useState } from 'react';

/**
 * NewMax `EditorInitializingState` + `DelayedRunningDot`.
 *
 * A pane-level placeholder shown while a freshly-activated surface is not yet
 * ready to render its real content (the panel layout motion is still settling,
 * or the conversation page is still loading). The indicator itself is delayed
 * by `delayMs` so fast paths — a cached conversation page that resolves within
 * the delay — never flash it at all. This mirrors NewMax's
 * `EditorInitializingState, { delayMs: 120 }` inside `TabContent` when
 * `isActive && !activationReady`.
 */
function RunningDot({ className }: { className?: string }) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: 'currentColor',
        opacity: 0.45,
        animation: 'shell-editor-initializing-pulse 1.1s ease-in-out infinite',
      }}
    />
  );
}

export function EditorInitializingState({
  label,
  className,
  delayMs = 0,
}: {
  label: string;
  className?: string;
  delayMs?: number;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (delayMs <= 0) {
      setShow(true);
      return;
    }
    const timer = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  if (!show) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="editor-initializing-state"
      className={className}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <RunningDot className="shrink-0" />
    </div>
  );
}
