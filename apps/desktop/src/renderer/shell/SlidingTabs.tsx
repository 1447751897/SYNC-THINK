import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

export interface SlidingTabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
}

export function SlidingTabs({ children, className, ...props }: SlidingTabsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const measuredRef = useRef(false);

  const positionPill = useCallback((animate: boolean) => {
    const root = rootRef.current;
    if (!root) return;
    const pill = root.querySelector<HTMLElement>('.shell-sliding-tabs__pill');
    const active = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!pill || !active) return;
    if (!animate) pill.style.transition = 'none';
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.style.width = `${active.offsetWidth}px`;
    if (!animate) {
      void pill.offsetWidth;
      pill.style.removeProperty('transition');
    }
  }, []);

  useLayoutEffect(() => {
    positionPill(measuredRef.current);
    measuredRef.current = true;
  });

  useEffect(() => {
    const snapToLayout = () => positionPill(false);
    window.addEventListener('resize', snapToLayout);
    return () => window.removeEventListener('resize', snapToLayout);
  }, [positionPill]);

  return (
    <div
      {...props}
      ref={rootRef}
      role="tablist"
      className={['shell-sliding-tabs', className].filter(Boolean).join(' ')}
    >
      <span className="shell-sliding-tabs__pill" aria-hidden="true" />
      {children}
    </div>
  );
}
