import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { OverlayScrollArea } from './OverlayScrollArea.js';

export interface ModelListSelectOption {
  value: string;
  label: string;
  /** Optional rich row content, used for provider icons and status tags. */
  render?: ReactNode;
}

/** 选项行距：min-height 32px 的行加 2px 行间 gap。 */
const ROW_STEP = 34;
/** 菜单内边距（4px×2）加边框（1px×2），用于换算 border-box 高度。 */
const MENU_CHROME = 10;
/** 菜单与触发器、与视口边缘的间距。 */
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
/** 空间再紧也至少露出这么多行，否则菜单会退化成一条看不见内容的缝。 */
const MIN_VISIBLE_ROWS = 4;

/** 完整装下 itemCount 行所需的 border-box 高度。 */
export function menuNaturalHeight(itemCount: number): number {
  if (itemCount <= 0) return MENU_CHROME;
  return itemCount * ROW_STEP - 2 + MENU_CHROME;
}

export interface MenuLayout {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * 按触发器的当前位置与视口高度算出菜单几何。
 *
 * 高度绝不能写死：一旦上限和内容高度只差几像素（例如 7 项内容 246px、上限 240px），
 * 可滚区间就只剩十几像素 —— 滚轮推一下几乎不位移，用户看到的是最后一行被切掉
 * 而且"滚不动"。这里改成按可用空间自适应：放得下就完整展开不出现滚动条，
 * 放不下才收缩，并且滚动区间有实际意义。
 */
export function computeMenuLayout(input: {
  itemCount: number;
  triggerTop: number;
  triggerBottom: number;
  triggerLeft: number;
  triggerWidth: number;
  viewportHeight: number;
}): MenuLayout {
  const natural = menuNaturalHeight(input.itemCount);
  // 扣掉与触发器和视口边缘的间距，得到上下两侧真实可用的高度。
  const below = input.viewportHeight - input.triggerBottom - MENU_GAP - VIEWPORT_MARGIN;
  const above = input.triggerTop - MENU_GAP - VIEWPORT_MARGIN;
  const floor = Math.min(natural, MIN_VISIBLE_ROWS * ROW_STEP + MENU_CHROME);
  // 下方放不下最低要求、且上方更宽裕时向上翻转，避免菜单被视口底边裁掉。
  const openUp = below < floor && above > below;
  const available = Math.max(0, openUp ? above : below);
  const maxHeight = Math.max(floor, Math.min(natural, available));
  const preferredTop = openUp
    ? input.triggerTop - MENU_GAP - maxHeight
    : input.triggerBottom + MENU_GAP;
  // 贴边保护：翻转后仍越界时（视口极矮）把菜单压回可视区内。
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(preferredTop, input.viewportHeight - VIEWPORT_MARGIN - maxHeight),
  );
  return {
    top,
    left: input.triggerLeft,
    width: Math.max(input.triggerWidth, 160),
    maxHeight,
  };
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
  const [coords, setCoords] = useState<MenuLayout>({ top: 0, left: 0, width: 0, maxHeight: 0 });
  const selected = options.find((option) => option.value === value);
  const display =
    selected?.label ?? (value === (emptyOption?.value ?? '') ? emptyOption?.label : undefined);
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
      setCoords(
        computeMenuLayout({
          itemCount: options.length + (emptyOption ? 1 : 0),
          triggerTop: rect.top,
          triggerBottom: rect.bottom,
          triggerLeft: rect.left,
          triggerWidth: rect.width,
          viewportHeight: window.innerHeight,
        }),
      );
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
        <span className={clsx(placeholderShown && 'is-placeholder')}>
          {selected?.render ?? display ?? placeholder}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="model-list-select__menu"
              role="listbox"
              aria-label={label}
              style={{
                top: coords.top,
                left: coords.left,
                width: coords.width,
                maxHeight: coords.maxHeight,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <OverlayScrollArea
                className="model-list-select__viewport"
                innerClassName="model-list-select__scroll"
                fadeColor="var(--color-overlay)"
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
                      <span>{option.render ?? option.label}</span>
                      {active ? <Check size={14} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </OverlayScrollArea>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
