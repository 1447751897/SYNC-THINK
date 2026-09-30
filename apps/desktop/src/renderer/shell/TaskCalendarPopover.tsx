import * as Dialog from '@radix-ui/react-dialog';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type CalendarPopoverSide = 'bottom' | 'right';
export function calendarPopoverPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: CalendarPopoverSide,
) {
  const margin = 12,
    gap = 8;
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - margin * 2));
  let left = anchor.left,
    top = anchor.bottom + gap;
  if (preferred === 'right' && viewport.width >= 620) {
    left = anchor.right + gap;
    if (left + width > viewport.width - margin) left = anchor.left - width - gap;
    top = (anchor.top + anchor.bottom - height) / 2;
  } else if (top + height > viewport.height - margin && anchor.top - height - gap >= margin) {
    top = anchor.top - height - gap;
  }
  return {
    left: Math.max(margin, Math.min(left, viewport.width - width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - height - margin)),
    width,
    maxHeight: Math.max(0, viewport.height - margin * 2),
  };
}

/** Non-modal anchored surface: reuse the shell's focus/dismiss primitive, without a scrim. */
export function CalendarPopover({
  anchor,
  title,
  side = 'bottom',
  onClose,
  children,
}: {
  anchor: HTMLElement;
  title: string;
  side?: CalendarPopoverSide;
  onClose(): void;
  children: ReactNode;
}) {
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const focused = useRef(false);
  const shouldRestore = useRef(true);
  const [position, setPosition] = useState<ReturnType<typeof calendarPopoverPosition> | null>(null);
  useLayoutEffect(() => {
    const reposition = () => {
      const element = content;
      if (!element) return;
      if (!anchor.isConnected) {
        onClose();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const clip = anchor.closest('.task-cal__scroll')?.getBoundingClientRect();
      if (
        clip &&
        (rect.bottom < clip.top ||
          rect.top > clip.bottom ||
          rect.right < clip.left ||
          rect.left > clip.right)
      ) {
        onClose();
        return;
      }
      setPosition(
        calendarPopoverPosition(
          rect,
          { width: 320, height: element.getBoundingClientRect().height },
          { width: window.innerWidth, height: window.innerHeight },
          side,
        ),
      );
    };
    reposition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition);
    if (content) observer?.observe(content);
    observer?.observe(anchor);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !content?.contains(event.target)) reposition();
    };
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', scroll, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [anchor, side, content, onClose]);
  useLayoutEffect(() => {
    if (!position || !content || focused.current) return;
    focused.current = true;
    (content.querySelector<HTMLElement>('[data-autofocus]') ?? content).focus();
  }, [content, position]);
  return (
    <Dialog.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          ref={setContent}
          className="task-cal__popover"
          aria-describedby={undefined}
          style={{
            position: 'fixed',
            ...(position ?? { width: 320 }),
            visibility: position ? 'visible' : 'hidden',
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (shouldRestore.current && anchor.isConnected) anchor.focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent.target;
            // The trigger's own click toggles; do not let dismiss race against that click.
            if (target instanceof Node && anchor.contains(target)) event.preventDefault();
            else shouldRestore.current = false;
          }}
        >
          <Dialog.Title className="task-cal__sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
