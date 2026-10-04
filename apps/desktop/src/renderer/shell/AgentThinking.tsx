/*!
 * @license MIT License
 *
 * Copyright (c) 2026 Mertcan Dundar Esmergul (BoardUI)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Adapted from BoardUI/components/application/agent-thinking/agent-thinking.tsx.
// Reference: https://www.boardui.com/components/agent-thinking
// Host adaptation: local theme tokens, Chinese copy, real-run elapsed labels,
// accessible announcements and suspension for reduced motion / inactive layers.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { useKeepAliveActive } from './KeepAliveLayer.js';

export type AgentThinkingVariant = 'wave' | 'spin' | 'stars' | 'infinity';
export type AgentThinkingTone = 'subtle' | 'default' | 'primary' | 'accent';
export interface AgentThinkingProps {
  variant?: AgentThinkingVariant;
  label?: string;
  tone?: AgentThinkingTone;
  shimmer?: boolean;
  showTimer?: boolean;
  /** Prefer the host's real run clock; mounting/reopening must not reset it. */
  elapsedLabel?: string;
  className?: string;
  testId?: string;
  /** Disable when the host already owns the live status region. */
  announce?: boolean;
}
const TONE_COLORS: Record<AgentThinkingTone, string> = {
  subtle: 'var(--color-text-faint)', default: 'var(--color-text-secondary)',
  primary: 'var(--color-text)', accent: 'var(--color-accent)',
};
const DOTS_SEED = [0.55, 0.3, 0.15, 0.85, 0.55, 0.3, 1, 0.85, 0.55];
const STAR_LAYOUT = [
  { x: 50, y: 46, scale: 1 }, { x: 18, y: 22, scale: 0.55 },
  { x: 82, y: 26, scale: 0.45 }, { x: 78, y: 76, scale: 0.55 },
  { x: 22, y: 78, scale: 0.4 },
];
const STAR_PATH = 'M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z';
const INFINITY_PATH = 'M28 14C33 5 47 5 47 14C47 23 33 23 28 14C23 5 9 5 9 14C9 23 23 23 28 14Z';

function useThinkingMotion() {
  const layerActive = useKeepAliveActive();
  const readMotion = () => !document.hidden
    && !document.documentElement.hasAttribute('data-reduced-motion')
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const refresh = () => setAllowed(readMotion());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    media?.addEventListener?.('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return layerActive && allowed;
}

function dotOpacities(variant: 'wave' | 'spin', phase: number) {
  return Array.from({ length: 9 }, (_, index) => {
    const col = index % 3, row = Math.floor(index / 3);
    const scalar = variant === 'wave' ? ((col + row) / 4) * 0.75
      : (Math.atan2(row - 1, col - 1) / (2 * Math.PI) + 1) % 1;
    const behind = (phase - scalar + 1) % 1;
    const lit = Math.max(0, 1 - behind / 0.3) ** 1.5;
    return 0.12 + 0.88 * lit;
  });
}
function DotsIndicator({ variant, motion }: { variant: 'wave' | 'spin'; motion: boolean }) {
  const [opacities, setOpacities] = useState(DOTS_SEED);
  useEffect(() => {
    if (!motion) { setOpacities(DOTS_SEED); return; }
    let phase = 0;
    const interval = window.setInterval(() => {
      phase = (phase + 1 / 8) % 1;
      setOpacities(dotOpacities(variant, phase));
    }, 80);
    return () => window.clearInterval(interval);
  }, [variant, motion]);
  return <span className="shell-agent-thinking__dots" aria-hidden="true">
    {opacities.map((opacity, index) => <span key={index} style={{ opacity }} />)}
  </span>;
}
function StarsIndicator() {
  return <span className="shell-agent-thinking__stars" aria-hidden="true">
    {STAR_LAYOUT.map((star, index) => {
      const size = 14 * star.scale;
      return <svg key={index} viewBox="0 0 24 24" className="shell-agent-thinking__star"
        style={{ width: size, height: size, left: star.x + '%', top: star.y + '%',
          marginLeft: -size / 2, marginTop: -size / 2, animationDelay: (index * 1.4 * 0.7) / 5 + 's' }}>
        <path d={STAR_PATH} fill="currentColor" />
      </svg>;
    })}
  </span>;
}
function InfinityIndicator() {
  return <svg className="shell-agent-thinking__infinity" viewBox="0 0 56 28" aria-hidden="true">
    <path d={INFINITY_PATH} fill="none" stroke="currentColor" strokeWidth={2.75} opacity={0.15} />
    <path d={INFINITY_PATH} fill="none" stroke="currentColor" strokeWidth={2.75}
      strokeLinecap="round" pathLength={100} strokeDasharray="11 89" className="shell-agent-thinking__comet" />
  </svg>;
}
function ElapsedTimer({ label, active, testId }: { label?: string; active: boolean; testId: string }) {
  const started = useRef(performance.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (label !== undefined || !active) return;
    const update = () => setElapsed((performance.now() - started.current) / 1000);
    let interval: number | undefined;
    const refresh = () => {
      if (interval !== undefined) window.clearInterval(interval);
      interval = undefined;
      if (document.hidden) return;
      update();
      interval = window.setInterval(update, 100);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [label, active]);
  // The status label is announced; the changing clock is visual-only.
  return <span className="shell-agent-thinking__timer" data-testid={testId} aria-hidden="true">
    {label ?? elapsed.toFixed(1) + 's'}
  </span>;
}
export function AgentThinking({ variant = 'wave', label = '思考中', tone,
  shimmer = true, showTimer = true, elapsedLabel, className, testId = 'agent-thinking', announce = true,
}: AgentThinkingProps) {
  const motion = useThinkingMotion();
  const active = useKeepAliveActive();
  const color = TONE_COLORS[tone ?? (variant === 'stars' ? 'subtle' : 'default')];
  return <div className={clsx('shell-agent-thinking', className)} role={announce ? 'status' : undefined} aria-live={announce ? 'polite' : undefined}
    data-testid={testId} data-variant={variant} data-motion={motion ? 'true' : 'false'}
    style={{ color, '--agent-thinking-tone': color } as CSSProperties}>
    <span className="shell-agent-thinking__indicator" data-testid="agent-thinking-indicator" aria-hidden="true">
      {variant === 'wave' || variant === 'spin' ? <DotsIndicator variant={variant} motion={motion} /> : null}
      {variant === 'stars' ? <StarsIndicator /> : null}
      {variant === 'infinity' ? <InfinityIndicator /> : null}
    </span>
    <span className={clsx('shell-agent-thinking__label', shimmer && 'shell-agent-thinking__label--shimmer')}
      data-testid={testId + '-label'} data-label={label}>{label}</span>
    {showTimer ? <ElapsedTimer label={elapsedLabel} active={active} testId={testId + '-timer'} /> : null}
  </div>;
}
