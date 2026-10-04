import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  Children,
  isValidElement,
  useId,
  type ReactNode,
  type SelectHTMLAttributes,
  type ChangeEvent,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './TaskExperience.css';
import { useTaskSheetPortalContainer } from './TaskSheet.js';

type Choice = { value: string; label: ReactNode; disabled?: boolean; group?: string };
function choices(children: ReactNode, group?: string): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean; label?: string }>(
        child,
      )
    )
      return [];
    if (child.type === 'option')
      return [
        {
          value: String(child.props.value ?? ''),
          label: child.props.children,
          disabled: child.props.disabled,
          group,
        },
      ];
    return choices(child.props.children, child.type === 'optgroup' ? child.props.label : group);
  });
}
/** App-owned, keyboard-accessible menu. Accepts existing option markup while avoiding OS menus. */
export function TaskSelect({
  children,
  value,
  onChange,
  disabled,
  className,
  id,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const portalContainer = useTaskSheetPortalContainer();
  const generatedId = useId();
  const items = choices(children);
  const current = String(value ?? '');
  const selected = items.find((item) => item.value === current);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          role="combobox"
          data-value={current}
          id={id ?? generatedId}
          disabled={disabled}
          className={['task-choice', className].filter(Boolean).join(' ')}
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-labelledby']}
          aria-describedby={props['aria-describedby']}
          data-testid={props['data-testid' as keyof typeof props] as string | undefined}
        >
          <span>{selected?.label ?? '请选择'}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal container={portalContainer}>
        <Menu.Content
          className="task-choice-menu"
          sideOffset={6}
          align="start"
          collisionPadding={12}
        >
          <Menu.RadioGroup
            value={current}
            onValueChange={(next) =>
              onChange?.({
                target: { value: next },
                currentTarget: { value: next },
              } as ChangeEvent<HTMLSelectElement>)
            }
          >
            {items.map((item, index) => (
              <span key={item.value + ':' + index}>
                {item.group && items[index - 1]?.group !== item.group && (
                  <Menu.Label className="task-choice-menu__group">{item.group}</Menu.Label>
                )}
                <Menu.RadioItem
                  data-value={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className="task-choice-menu__item"
                >
                  <span>{item.label}</span>
                  <Menu.ItemIndicator>
                    <Check size={14} />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              </span>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
