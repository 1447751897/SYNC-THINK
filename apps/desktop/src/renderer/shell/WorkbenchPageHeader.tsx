import type { ReactNode } from 'react';

/** Shared chrome; pages retain their own calendar, library or split-pane body. */
export function WorkbenchPageHeader({
  heading,
  actions,
  className = '',
}: {
  heading: ReactNode;
  actions?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <header className={`workbench-page__header ${className}`}>
      <div className="workbench-page__heading">{heading}</div>
      {actions ? <div className="workbench-page__actions">{actions}</div> : null}
    </header>
  );
}
