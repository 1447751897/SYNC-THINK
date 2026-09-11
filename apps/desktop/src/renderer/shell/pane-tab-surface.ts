import { useLayoutEffect, useRef, type RefObject } from 'react';
import { spring } from 'motion';

// beUI Morphing Tabs' glide, shared by the surface path and displaced labels.
export const PANE_TAB_GLIDE = String(
  spring({ keyframes: [0, 1], stiffness: 700, damping: 50, mass: 0.5 }),
);

/** Compact beUI liquid join: 28px tab, 12px top inset, 12px shoulders. */
export function paneTabSurfacePath(left: number, width: number, railWidth: number): string {
  const right = left + width;
  const radius = Math.min(12, width / 2);
  const leftJoin = Math.max(0, left - 12);
  const rightJoin = Math.min(railWidth, right + 12);
  const leftDepth = Math.max(0, left - leftJoin);
  const rightDepth = Math.max(0, rightJoin - right);
  const leftControl = leftDepth * 0.55;
  const rightControl = rightDepth * 0.55;
  return [
    'M 0 41 V 40',
    `H ${leftJoin}`,
    `C ${leftJoin + leftControl} 40 ${left} ${40 - leftDepth + leftControl} ${left} ${40 - leftDepth}`,
    `V ${12 + radius} Q ${left} 12 ${left + radius} 12`,
    `H ${right - radius} Q ${right} 12 ${right} ${12 + radius}`,
    `V ${40 - rightDepth}`,
    `C ${right} ${40 - rightDepth + rightControl} ${rightJoin - rightControl} 40 ${rightJoin} 40`,
    `H ${railWidth} V 41 Z`,
  ].join(' ');
}

/** Selector for the active tab inside the track. The conversation rail and the
 *  workbench rail use different tab classes, so this is parameterised. */
const DEFAULT_ACTIVE_TAB_SELECTOR = '.shell-pane-tab[data-active="true"]';

export function usePaneTabSurface(
  rootRef: RefObject<HTMLDivElement>,
  trackRef: RefObject<HTMLDivElement>,
  activeTabSelector: string = DEFAULT_ACTIVE_TAB_SELECTOR,
) {
  const pathRef = useRef<SVGPathElement>(null);
  const initializedRef = useRef(false);
  const updateRef = useRef<(animate: boolean) => void>(() => {});

  useLayoutEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const path = pathRef.current;
    if (!root || !track || !path) return;

    const update = (animate: boolean) => {
      const active = track.querySelector<HTMLElement>(activeTabSelector);
      if (!active) {
        path.style.display = 'none';
        initializedRef.current = false;
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      if (!rootRect.width || !active.offsetWidth) return;

      // Read the target transform, not the in-flight CSS position. The same
      // spring then keeps the label and its liquid shoulder exactly in step.
      const translation = active.style.transform && typeof DOMMatrixReadOnly !== 'undefined'
        ? new DOMMatrixReadOnly(active.style.transform).m41
        : 0;
      const left = trackRect.left - rootRect.left + active.offsetLeft + translation - track.scrollLeft;
      const nextPath = paneTabSurfacePath(left, active.offsetWidth, rootRect.width);
      const reduce = document.documentElement.hasAttribute('data-reduced-motion') ||
        (document.documentElement.dataset.motion !== 'full' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      const snap = !animate || !initializedRef.current || reduce || active.classList.contains('is-dragging');
      path.style.display = '';
      path.style.transition = snap ? 'none' : '';
      path.style.setProperty('d', `path("${nextPath}")`);
      initializedRef.current = true;
    };

    updateRef.current = update;
    update(false);
    const snap = () => update(false);
    const mutations = new MutationObserver(() => update(true));
    mutations.observe(track, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'data-active', 'class'],
    });
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(snap) : null;
    resize?.observe(root);
    resize?.observe(track);
    track.addEventListener('scroll', snap, { passive: true });
    window.addEventListener('resize', snap);
    return () => {
      mutations.disconnect();
      resize?.disconnect();
      track.removeEventListener('scroll', snap);
      window.removeEventListener('resize', snap);
      updateRef.current = () => {};
    };
  }, [rootRef, trackRef, activeTabSelector]);

  useLayoutEffect(() => updateRef.current(true));

  return pathRef;
}
