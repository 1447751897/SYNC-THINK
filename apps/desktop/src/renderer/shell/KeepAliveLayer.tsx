import { createContext, memo, useContext, useRef, type ReactNode } from 'react';

const KeepAliveActiveContext = createContext(true);

export function useKeepAliveActive(): boolean {
  return useContext(KeepAliveActiveContext);
}

/**
 * Keeps a stage surface mounted so its DOM (scroll offsets, canvas/video state,
 * in-flight input) survives stage switches.
 *
 * Performance: ShellApp rebuilds every child element on each of its renders, so
 * a plain `memo` on this component would never hit — `children` changes
 * identity every time. Instead the comparator deliberately ignores `children`
 * while the layer is inactive, and the component reuses ("freezes") the last
 * active child tree. React's element-identity bailout then skips re-rendering
 * that entire subtree, which is where the expensive shells live (ChatView is
 * ~9k lines). Layers are only frozen while inactive; the render in which a
 * layer becomes active again always refreshes the children, so a stage switch
 * picks up current data in the same commit and is not observable.
 */
export const KeepAliveLayer = memo(
  function KeepAliveLayer(props: {
    active: boolean;
    className?: string;
    testId?: string;
    /** Keep size/scroll (visibility:hidden) instead of collapsing with `hidden`. */
    preserveLayout?: boolean;
    children: ReactNode;
  }) {
    const visited = useRef(props.active);
    if (props.active) visited.current = true;
    const frozenChildren = useRef(props.children);
    if (props.active) frozenChildren.current = props.children;
    if (!visited.current) return null;
    return (
      <KeepAliveActiveContext.Provider value={props.active}>
        <div
          className={props.className}
          hidden={props.preserveLayout ? undefined : !props.active}
          aria-hidden={!props.active}
          data-active={props.active ? 'true' : 'false'}
          data-testid={props.testId}
        >
          {frozenChildren.current}
        </div>
      </KeepAliveActiveContext.Provider>
    );
  },
  (prev, next) =>
    prev.active === next.active &&
    prev.className === next.className &&
    prev.testId === next.testId &&
    prev.preserveLayout === next.preserveLayout &&
    // While active, children must flow through normally; while inactive they are
    // intentionally ignored so the subtree can be skipped.
    (!next.active || prev.children === next.children),
);
