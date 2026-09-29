import { useEffect, useRef, useState } from 'react';
import { CodeBlockButton } from './CodeBlockButton.js';
import { Check, Copy } from 'lucide-react';

export function CopyTextButton({
  text,
  label = '复制代码',
  compact = false,
}: {
  text: string;
  label?: string;
  compact?: boolean;
}) {
  const [feedback, setFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  const copy = async () => {
    let result: 'copied' | 'failed';
    try {
      await navigator.clipboard.writeText(text);
      result = 'copied';
    } catch {
      result = 'failed';
    }
    if (!mountedRef.current) return;
    clearTimeout(timerRef.current);
    setFeedback(result);
    timerRef.current = setTimeout(() => setFeedback('idle'), 1600);
  };

  const Button = compact ? CodeBlockButton : 'button';
  return (
    <Button
      type="button"
      className={`shell-source-copy${compact ? ' is-icon-only' : ''}`}
      data-copy-state={feedback}
      aria-label={label}
      title={feedback === 'copied' ? '已复制' : feedback === 'failed' ? '复制失败，请重试' : label}
      onClick={() => void copy()}
    >
      {feedback === 'copied' ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      <span role="status" aria-live="polite">
        {feedback === 'copied' ? '已复制' : feedback === 'failed' ? '复制失败' : '复制'}
      </span>
    </Button>
  );
}
