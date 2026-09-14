import { useRef, type ReactNode } from 'react';

export function KeepAliveLayer(props: {
  active: boolean;
  className?: string;
  testId?: string;
  /** Keep size/scroll (visibility:hidden) instead of collapsing with `hidden`. */
  preserveLayout?: boolean;
  children: ReactNode;
}) {
  const visited = useRef(props.active);
  if (props.active) visited.current = true;
  if (!visited.current) return null;
  return (
    <div
      className={props.className}
      hidden={props.preserveLayout ? undefined : !props.active}
      aria-hidden={!props.active}
      data-active={props.active ? 'true' : 'false'}
      data-testid={props.testId}
    >
      {props.children}
    </div>
  );
}
