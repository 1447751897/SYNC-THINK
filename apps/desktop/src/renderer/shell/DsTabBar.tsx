import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import clsx from 'clsx';

export interface DsTabBarItem<T extends string = string> {
  value: T;
  icon?: ReactNode;
  label?: string;
  tooltip?: string;
  disabled?: boolean;
}

const SIZE = {
  small: { pad: 2, icon: 15 },
  default: { pad: 3, icon: 16 },
  large: { pad: 3, icon: 18 },
} as const;

export function DsTabBar<T extends string>({
  items,
  value,
  onChange,
  size = 'small',
  stretch = false,
  className,
  'aria-label': ariaLabel,
}: {
  items: readonly DsTabBarItem<T>[];
  value: T;
  onChange(next: T): void;
  size?: keyof typeof SIZE;
  stretch?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = items.findIndex((item) => item.value === value);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const [indicator, setIndicator] = useState({
    left: 0,
    width: 0,
    height: 0,
    animated: false,
  });
  const pad = SIZE[size].pad;
  const iconPx = SIZE[size].icon;
  const firstEnabledIndex = items.findIndex((item) => !item.disabled);

  const activateTab = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    onChange(item.value);
    btnRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabledIndexes = items.flatMap((item, itemIndex) => (item.disabled ? [] : [itemIndex]));
    if (enabledIndexes.length === 0) return;

    const currentPosition = Math.max(0, enabledIndexes.indexOf(index));
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = enabledIndexes[(currentPosition + 1) % enabledIndexes.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex =
        enabledIndexes[(currentPosition - 1 + enabledIndexes.length) % enabledIndexes.length];
    } else if (event.key === 'Home') {
      nextIndex = enabledIndexes[0];
    } else if (event.key === 'End') {
      nextIndex = enabledIndexes[enabledIndexes.length - 1];
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    activateTab(nextIndex);
  };

  useLayoutEffect(() => {
    if (selectedIndex < 0) {
      setIndicator((prev) => ({ left: 0, width: 0, height: 0, animated: prev.width > 0 }));
      return;
    }
    const btn = btnRefs.current[Math.max(0, selectedIndex)];
    if (!btn) return;
    setIndicator((prev) => ({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
      height: btn.offsetHeight,
      animated: prev.width > 0,
    }));
  }, [selectedIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let firstFire = true;
    const observer = new ResizeObserver(() => {
      if (firstFire) {
        firstFire = false;
        return;
      }
      if (selectedIndexRef.current < 0) {
        setIndicator({ left: 0, width: 0, height: 0, animated: false });
        return;
      }
      const btn = btnRefs.current[Math.max(0, selectedIndexRef.current)];
      if (!btn) return;
      setIndicator({
        left: btn.offsetLeft,
        width: btn.offsetWidth,
        height: btn.offsetHeight,
        animated: false,
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      className={clsx('shell-ds-tab-bar', `is-${size}`, stretch && 'is-stretch', className)}
      style={{ padding: pad }}
    >
      {indicator.width > 0 ? (
        <div
          aria-hidden="true"
          className={clsx('shell-ds-tab-bar__indicator', indicator.animated && 'is-animated')}
          style={{
            top: pad,
            left: indicator.left,
            width: indicator.width,
            height: indicator.height,
          }}
        />
      ) : null}
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              btnRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            disabled={item.disabled}
            aria-label={item.tooltip ?? item.label}
            title={item.tooltip ?? item.label}
            aria-selected={selected}
            tabIndex={selected || (selectedIndex < 0 && index === firstEnabledIndex) ? 0 : -1}
            className={clsx(
              'shell-ds-tab-bar__tab',
              selected && 'is-active',
              stretch && 'is-stretch',
            )}
            onClick={() => {
              if (!item.disabled) onChange(item.value);
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {item.icon ? (
              <span className="shell-ds-tab-bar__icon" style={{ width: iconPx, height: iconPx }}>
                {item.icon}
              </span>
            ) : null}
            {item.label ? <span className="shell-ds-tab-bar__label">{item.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
