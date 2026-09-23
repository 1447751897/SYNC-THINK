import clsx from 'clsx';

export interface ToggleControlProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(value: boolean): void;
  className: string;
  thumbClassName?: string;
}

export function ToggleControl({
  checked,
  disabled,
  label,
  onChange,
  className,
  thumbClassName,
}: ToggleControlProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      data-enabled={checked ? '1' : '0'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(className, checked && 'is-checked')}
    >
      <span className={thumbClassName} />
    </button>
  );
}
