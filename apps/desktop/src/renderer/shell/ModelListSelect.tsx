import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';

export interface ModelListSelectOption {
  value: string;
  label: string;
}

export function ModelListSelect({
  id,
  label,
  value,
  placeholder,
  disabled,
  options,
  emptyOption,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  options: readonly ModelListSelectOption[];
  emptyOption?: ModelListSelectOption;
  onChange(value: string): void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const selected = options.find((option) => option.value === value);
  const display = selected?.label ?? (value === (emptyOption?.value ?? '') ? emptyOption?.label : undefined);
  const placeholderShown = !display;

  const close = () => setOpen(false);

  const toggle = () => {
    if (disabled) return;
    if (open) {
      close();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const itemCount = options.length + (emptyOption ? 1 : 0);
      const menuHeight = Math.min(itemCount * 32 + 8, 240);
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow < menuHeight && rect.top > menuHeight
          ? rect.top - menuHeight - 4
          : rect.bottom + 4;
      setCoords({ top, left: rect.left, width: Math.max(rect.width, 160) });
    }
    setOpen(true);
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

  const choose = (next: string) => {
    onChange(next);
    close();
  };

  const rows = emptyOption ? [emptyOption, ...options] : [...options];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={clsx('model-list-select__trigger', open && 'is-open')}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <span className={clsx(placeholderShown && 'is-placeholder')}>{display ?? placeholder}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="model-list-select__menu"
              role="listbox"
              aria-label={label}
              style={{ top: coords.top, left: coords.left, width: coords.width }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {rows.map((option) => {
                const active = option.value === value || (!value && option.value === '');
                return (
                  <button
                    key={option.value || 'empty'}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={active}
                    className={clsx('model-list-select__option', active && 'is-active')}
                    onPointerDown={(event) => {
                      if (event.button > 0) return;
                      event.preventDefault();
                      event.stopPropagation();
                      choose(option.value);
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      choose(option.value);
                    }}
                  >
                    <span>{option.label}</span>
                    {active ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
