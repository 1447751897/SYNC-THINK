import clsx from 'clsx';
import { DsTabBar, type DsTabBarItem } from './DsTabBar.js';

export interface SettingsSectionTabsProps<T extends string> {
  items: readonly DsTabBarItem<T>[];
  value: T;
  onChange(next: T): void;
  className?: string;
  'aria-label': string;
}

export function SettingsSectionTabs<T extends string>({
  items,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SettingsSectionTabsProps<T>) {
  return (
    <div className={clsx('settings-section-tabs-viewport', className)}>
      <DsTabBar<T>
        className="settings-section-tabs"
        aria-label={ariaLabel}
        items={items}
        value={value}
        onChange={onChange}
        size="large"
      />
    </div>
  );
}
