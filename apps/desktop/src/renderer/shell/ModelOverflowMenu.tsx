import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';

export interface ModelOverflowMenuItem {
  label: string;
  danger?: boolean;
  confirmLabel?: string;
  onSelect(): void;
}

export function ModelOverflowMenu({
  ariaLabel,
  title = '更多操作',
  disabled,
  triggerClassName,
  triggerTestId,
  triggerSize = 15,
  items,
  onOpenChange,
}: {
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  triggerClassName?: string;
  triggerTestId?: string;
  triggerSize?: number;
  items: ModelOverflowMenuItem[];
  onOpenChange?: (open: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const close = () => {
    setOpen(false);
    setConfirming(null);
    onOpenChange?.(false);
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({ top: rect.bottom + 4, left: rect.right });
    }
    setOpen(true);
    onOpenChange?.(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={clsx('model-overflow-menu__trigger', triggerClassName)}
        title={title}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid={triggerTestId}
        data-state={open ? 'open' : 'closed'}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <MoreHorizontal size={triggerSize} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="model-overflow-menu"
              role="menu"
              style={{ top: coords.top, left: coords.left }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {items.map((item, index) => (
                <OverflowMenuEntry
                  key={item.label}
                  item={item}
                  showSeparator={Boolean(item.danger && index > 0)}
                  confirming={confirming === item.label}
                  onConfirming={() => setConfirming(item.label)}
                  onChose={() => {
                    item.onSelect();
                    close();
                  }}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function OverflowMenuEntry({
  item,
  showSeparator,
  confirming,
  onConfirming,
  onChose,
}: {
  item: ModelOverflowMenuItem;
  showSeparator: boolean;
  confirming: boolean;
  onConfirming(): void;
  onChose(): void;
}): ReactNode {
  return (
    <>
      {showSeparator ? <div className="model-overflow-menu__separator" role="separator" /> : null}
      <button
        type="button"
        role="menuitem"
        className={clsx('model-overflow-menu__item', item.danger && 'is-danger')}
        onPointerDown={(event) => {
          if (event.button > 0) return;
          event.preventDefault();
          event.stopPropagation();
          if (item.confirmLabel && !confirming) {
            onConfirming();
            return;
          }
          onChose();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (item.confirmLabel && !confirming) {
            onConfirming();
            return;
          }
          onChose();
        }}
      >
        {confirming ? (item.confirmLabel ?? item.label) : item.label}
      </button>
    </>
  );
}
