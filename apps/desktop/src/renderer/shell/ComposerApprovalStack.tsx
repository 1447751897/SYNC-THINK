import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export const COMPOSER_PEEK_TRANSITION_MS = 220;

export interface ComposerPeekItem {
  key: string;
  node: ReactNode;
}

export interface ComposerApprovalStackProps {
  tool?: ComposerPeekItem;
  plan?: ComposerPeekItem;
  /** A Plan/Goal banner below the approvals owns the overlap with the composer. */
  hasSurfaceBelow?: boolean;
}

type PeekState = 'entering' | 'stable' | 'exiting';

function transitionMs(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return COMPOSER_PEEK_TRANSITION_MS;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : COMPOSER_PEEK_TRANSITION_MS;
}

function ComposerPeekSurface(props: {
  item?: ComposerPeekItem;
  kind: 'tool' | 'plan';
  detached: boolean;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const previousKeyRef = useRef(props.item?.key);
  const [displayed, setDisplayed] = useState(props.item);
  const displayedRef = useRef(props.item);
  const [state, setState] = useState<PeekState>('stable');

  useLayoutEffect(() => {
    const previousKey = previousKeyRef.current;
    const nextKey = props.item?.key;

    if (previousKey === nextKey) {
      if (props.item) {
        displayedRef.current = props.item;
        setDisplayed(props.item);
      }
      return;
    }

    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }

    previousKeyRef.current = nextKey;

    if (props.item) {
      displayedRef.current = props.item;
      setDisplayed(props.item);
      setState('entering');
      timerRef.current = setTimeout(() => {
        setState('stable');
        timerRef.current = undefined;
      }, transitionMs());
      return;
    }

    if (!previousKey || !displayedRef.current) return;
    setState('exiting');
    timerRef.current = setTimeout(() => {
      displayedRef.current = undefined;
      setDisplayed(undefined);
      setState('stable');
      timerRef.current = undefined;
    }, transitionMs());
  }, [props.item]);

  useLayoutEffect(
    () => () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    },
    [],
  );

  if (!displayed) return null;

  return (
    <div
      className={`shell-composer-peek-surface is-${props.kind} is-${state}`}
      data-testid="composer-peek-surface"
      data-kind={props.kind}
      data-state={state}
      data-detached={props.detached ? 'true' : 'false'}
      aria-hidden={state === 'exiting' ? 'true' : undefined}
    >
      <div className="shell-composer-peek-surface__clip">
        <div className="shell-composer-peek-surface__content">{displayed.node}</div>
      </div>
    </div>
  );
}

/** NewMax ordering: tool approval, plan approval, mode banner, composer. */
export function ComposerApprovalStack(props: ComposerApprovalStackProps) {
  if (!props.tool && !props.plan) {
    return (
      <div className="shell-composer-approval-stack" aria-hidden="true">
        <ComposerPeekSurface kind="tool" detached={false} />
        <ComposerPeekSurface kind="plan" detached={false} />
      </div>
    );
  }

  return (
    <div
      className="shell-composer-approval-stack"
      data-stacked={props.tool && props.plan ? 'true' : 'false'}
    >
      <ComposerPeekSurface
        item={props.tool}
        kind="tool"
        detached={Boolean(props.plan) || Boolean(props.hasSurfaceBelow)}
      />
      <ComposerPeekSurface
        item={props.plan}
        kind="plan"
        detached={Boolean(props.hasSurfaceBelow)}
      />
    </div>
  );
}
