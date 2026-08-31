import {
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

export const NEWMAX_POPOVER_TRANSITION_MS = 150;
export const NEWMAX_PLAN_BANNER_TRANSITION_MS = 220;
export const NEWMAX_GOAL_BANNER_TRANSITION_MS = 240;
/** @deprecated Use the mode-specific constants above. */
export const NEWMAX_MODE_BANNER_TRANSITION_MS = NEWMAX_GOAL_BANNER_TRANSITION_MS;

export type NewMaxMotionPhase = 'idle' | 'entering' | 'stable' | 'exiting';
type ComposerModeKind = 'plan' | 'goal' | 'generic';

export function isNewMaxComposerMotionReduced(): boolean {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.hasAttribute('data-reduced-motion')
  ) {
    return true;
  }
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function motionDurationMs(durationMs: number): number {
  return isNewMaxComposerMotionReduced() ? 0 : durationMs;
}

function modeBannerTransitionMs(kind: ComposerModeKind): number {
  return motionDurationMs(
    kind === 'plan'
      ? NEWMAX_PLAN_BANNER_TRANSITION_MS
      : NEWMAX_GOAL_BANNER_TRANSITION_MS,
  );
}

function resolveModeBannerKind(node: ReactNode): ComposerModeKind {
  if (!isValidElement<{ mode?: unknown }>(node)) return 'generic';
  return node.props.mode === 'plan' || node.props.mode === 'goal' ? node.props.mode : 'generic';
}

function resolveModeBannerKey(node: ReactNode, kind: ComposerModeKind): string {
  if (!isValidElement(node) || node.key === null) return kind;
  return `${kind}:${String(node.key)}`;
}

export interface NewMaxPopoverPresence {
  rendered: boolean;
  phase: NewMaxMotionPhase;
  completeMotion(): void;
}

/** NewMax DsPopover-compatible mount retention for CSS entrance and exit motion. */
export function useNewMaxPopoverPresence(open: boolean): NewMaxPopoverPresence {
  const initiallyReduced = isNewMaxComposerMotionReduced();
  const [rendered, setRendered] = useState(open);
  const [phase, setPhase] = useState<NewMaxMotionPhase>(
    open ? (initiallyReduced ? 'stable' : 'entering') : 'idle',
  );
  const phaseRef = useRef(phase);
  const previousOpenRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  phaseRef.current = phase;

  const clearTimer = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  const completeMotion = useCallback(() => {
    clearTimer();
    if (phaseRef.current === 'entering') {
      phaseRef.current = 'stable';
      setPhase('stable');
      return;
    }
    if (phaseRef.current === 'exiting') {
      phaseRef.current = 'idle';
      setPhase('idle');
      setRendered(false);
    }
  }, [clearTimer]);

  useLayoutEffect(() => {
    clearTimer();
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;

    if (open) {
      setRendered(true);
      if (wasOpen) return;
      const durationMs = motionDurationMs(NEWMAX_POPOVER_TRANSITION_MS);
      if (durationMs === 0) {
        phaseRef.current = 'stable';
        setPhase('stable');
        return;
      }
      phaseRef.current = 'entering';
      setPhase('entering');
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        phaseRef.current = 'stable';
        setPhase('stable');
      }, durationMs);
      return;
    }

    if (!wasOpen) {
      phaseRef.current = 'idle';
      setPhase('idle');
      setRendered(false);
      return;
    }

    const durationMs = motionDurationMs(NEWMAX_POPOVER_TRANSITION_MS);
    if (durationMs === 0) {
      phaseRef.current = 'idle';
      setPhase('idle');
      setRendered(false);
      return;
    }
    phaseRef.current = 'exiting';
    setPhase('exiting');
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      phaseRef.current = 'idle';
      setPhase('idle');
      setRendered(false);
    }, durationMs);
  }, [clearTimer, open]);

  useLayoutEffect(() => clearTimer, [clearTimer]);

  return { rendered, phase, completeMotion };
}

export interface NewMaxComposerFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  variant: 'empty' | 'conversation';
  modeBanner?: ReactNode;
  menu?: ReactNode;
  beforeInput?: ReactNode;
  input?: ReactNode;
  afterInput?: ReactNode;
  toolbar?: ReactNode;
  afterToolbar?: ReactNode;
  children?: ReactNode;
  innerRef?: Ref<HTMLDivElement>;
}

/** Shared NewMax composer geometry. Run/queue behavior remains owned by each entry point. */
export function NewMaxComposerFrame({
  variant,
  modeBanner,
  menu,
  beforeInput,
  input,
  afterInput,
  toolbar,
  afterToolbar,
  children,
  innerRef,
  className = '',
  ...frameProps
}: NewMaxComposerFrameProps) {
  const hasModeBanner = modeBanner !== undefined && modeBanner !== null;
  const currentModeKind = hasModeBanner ? resolveModeBannerKind(modeBanner) : 'generic';
  const currentModeKey = hasModeBanner
    ? resolveModeBannerKey(modeBanner, currentModeKind)
    : 'none';
  const previousHasModeBannerRef = useRef(hasModeBanner);
  const previousModeKeyRef = useRef(currentModeKey);
  const lastModeBannerRef = useRef<{
    key: string;
    kind: ComposerModeKind;
    node: ReactNode;
  } | null>(
    hasModeBanner ? { key: currentModeKey, kind: currentModeKind, node: modeBanner } : null,
  );
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const [modeBannerPhase, setModeBannerPhase] = useState<NewMaxMotionPhase>(
    hasModeBanner ? 'stable' : 'idle',
  );

  if (hasModeBanner) {
    lastModeBannerRef.current = {
      key: currentModeKey,
      kind: currentModeKind,
      node: modeBanner,
    };
  }

  useLayoutEffect(() => {
    if (transitionTimerRef.current !== undefined) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = undefined;
    }

    const previouslyVisible = previousHasModeBannerRef.current;
    const previousModeKey = previousModeKeyRef.current;
    previousHasModeBannerRef.current = hasModeBanner;
    previousModeKeyRef.current = currentModeKey;

    if (hasModeBanner) {
      if (previouslyVisible && previousModeKey === currentModeKey) {
        setModeBannerPhase('stable');
        return;
      }
      const durationMs = modeBannerTransitionMs(currentModeKind);
      if (durationMs === 0) {
        setModeBannerPhase('stable');
        return;
      }
      setModeBannerPhase('entering');
      transitionTimerRef.current = setTimeout(() => {
        setModeBannerPhase('stable');
        transitionTimerRef.current = undefined;
      }, durationMs);
      return;
    }

    if (!previouslyVisible || lastModeBannerRef.current === null) {
      setModeBannerPhase('idle');
      return;
    }

    const durationMs = modeBannerTransitionMs(lastModeBannerRef.current.kind);
    if (durationMs === 0) {
      setModeBannerPhase('idle');
      return;
    }
    setModeBannerPhase('exiting');
    transitionTimerRef.current = setTimeout(() => {
      setModeBannerPhase('idle');
      transitionTimerRef.current = undefined;
    }, durationMs);
  }, [currentModeKey, currentModeKind, hasModeBanner]);

  useLayoutEffect(
    () => () => {
      if (transitionTimerRef.current !== undefined) clearTimeout(transitionTimerRef.current);
    },
    [],
  );

  const displayedModeBanner = hasModeBanner
    ? { key: currentModeKey, kind: currentModeKind, node: modeBanner }
    : modeBannerPhase === 'idle'
      ? null
      : lastModeBannerRef.current;

  return (
    <div
      className={`shell-newmax-composer-frame ${displayedModeBanner ? 'has-mode' : ''}`.trim()}
      data-testid="newmax-composer-frame"
      data-variant={variant}
      data-mode-state={modeBannerPhase}
    >
      {displayedModeBanner ? (
        <div
          key={displayedModeBanner.key}
          className={`shell-newmax-composer-frame__mode is-${modeBannerPhase}`}
          data-testid="newmax-composer-mode"
          data-mode={displayedModeBanner.kind}
          data-motion-key={displayedModeBanner.key}
          aria-hidden={modeBannerPhase === 'exiting' ? 'true' : undefined}
        >
          {displayedModeBanner.node}
        </div>
      ) : null}
      <div
        ref={innerRef}
        {...frameProps}
        className={`shell-compose shell-newmax-composer shell-newmax-composer--${variant} ${className}`.trim()}
      >
        {children ?? (
          <>
            {menu}
            {beforeInput}
            <div
              className={`shell-newmax-composer__editor is-${variant}`}
              data-testid="newmax-composer-editor"
            >
              {input}
            </div>
            {afterInput}
            {toolbar}
            {afterToolbar}
          </>
        )}
      </div>
    </div>
  );
}
