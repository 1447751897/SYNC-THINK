import { useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Folder } from 'lucide-react';
import { OverlayScrollArea } from './OverlayScrollArea.js';

export interface WorkspaceScopeOption {
  id: string;
  label: string;
  count?: number;
  testId?: string;
}

/** One responsive workspace filter used by both Skills and Agents. */
export function WorkspaceScopeRow({
  options,
  fixedCount,
  value,
  onChange,
  label,
}: {
  options: readonly WorkspaceScopeOption[];
  fixedCount: number;
  value: string;
  onChange(value: string): void;
  label: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(fixedCount + 4);
  // Keep the active workspace in view even if it was selected from the +N menu.
  const ordered = useMemo(() => {
    const fixed = options.slice(0, fixedCount);
    const workspaces = options.slice(fixedCount);
    const chosen = workspaces.find((option) => option.id === value);
    return chosen
      ? [...fixed, chosen, ...workspaces.filter((option) => option.id !== value)]
      : [...fixed, ...workspaces];
  }, [options, fixedCount, value]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const chips = Array.from(
        row.querySelectorAll<HTMLElement>(':scope > .ability-hub__scope-pill'),
      );
      const style = getComputedStyle(row);
      const width =
        row.clientWidth -
        parseFloat(style.paddingLeft || '0') -
        parseFloat(style.paddingRight || '0');
      if (width < 80 || chips.some((chip) => !chip.offsetWidth)) return;
      const gap = 8;
      let used = 0;
      let count = 0;
      for (const chip of chips) {
        const next = used + chip.offsetWidth + (count ? gap : 0);
        // Reserve space for the overflow button whenever later workspaces remain.
        if (next + (count + 1 < chips.length ? 58 + gap : 0) > width && count >= fixedCount) break;
        used = next;
        count += 1;
      }
      setVisibleCount(Math.max(fixedCount, count));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    measure();
    return () => observer.disconnect();
  }, [ordered, fixedCount]);

  const remaining = ordered.slice(visibleCount);
  return (
    <div ref={rowRef} className="ability-hub__workspace-row" role="group" aria-label={label}>
      {ordered.map((option, index) => (
        <button
          key={option.id}
          type="button"
          className={`ability-hub__scope-pill${value === option.id ? ' is-active' : ''}${index >= visibleCount ? ' is-measure-only' : ''}`}
          aria-pressed={value === option.id}
          aria-hidden={index >= visibleCount ? 'true' : undefined}
          tabIndex={index >= visibleCount ? -1 : undefined}
          data-testid={option.testId}
          onClick={() => onChange(option.id)}
        >
          <Folder size={11} aria-hidden="true" />
          {option.label}
          {option.count !== undefined ? <small>{option.count}</small> : null}
        </button>
      ))}
      {remaining.length > 0 ? (
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="ability-hub__scope-more"
              aria-label={`还有 ${remaining.length} 个工作区`}
            >
              +{remaining.length}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="ability-hub__scope-menu"
              align="start"
              sideOffset={6}
              collisionPadding={10}
            >
              <OverlayScrollArea
                className="ability-hub__scope-menu-viewport"
                innerClassName="ability-hub__scope-menu-scroll"
                fadeColor="var(--color-overlay)"
              >
                <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
                  {remaining.map((option) => (
                    <DropdownMenu.RadioItem
                      key={option.id}
                      value={option.id}
                      className="ability-hub__scope-menu-item"
                    >
                      <Folder size={13} aria-hidden="true" />
                      <span>{option.label}</span>
                      {option.count !== undefined ? <small>{option.count}</small> : null}
                      <DropdownMenu.ItemIndicator>
                        <Check size={13} aria-hidden="true" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </OverlayScrollArea>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
    </div>
  );
}
