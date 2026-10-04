import { Bot, CalendarClock, Globe, Home, Inbox, Users, Wrench } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ShellStage } from './shell-state.js';

const navigation = [
  { stage: 'talk', label: '主页', testId: 'nav-home', Icon: Home },
  { stage: 'activity', label: '收件箱', testId: 'nav-activity', Icon: Inbox },
  { stage: 'tasks', label: '定时任务', testId: 'nav-scheduled', Icon: CalendarClock },
  { stage: 'browser', label: '浏览器', testId: 'nav-browser', Icon: Globe },
  { stage: 'agents', label: '智能体', testId: 'nav-agents', Icon: Bot },
  { stage: 'teams', label: '小队', testId: 'nav-teams', Icon: Users },
  { stage: 'abilities', label: '能力', testId: 'nav-abilities', Icon: Wrench },
] as const;

export function SidebarNavigationRail({ stage, onSelectStage, onHome, settingsOpen, pendingUpdateVersion }: {
  stage: ShellStage;
  onSelectStage(stage: ShellStage): void;
  onHome(): void;
  settingsOpen?: boolean;
  pendingUpdateVersion?: string | null;
}) {
  const tooltipId = useId();
  const [tip, setTip] = useState<{ label: string; left: number; top: number }>();
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(undefined);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [tip]);
  const show = (button: HTMLButtonElement, label: string) => {
    const rect = button.getBoundingClientRect();
    setTip({ label, left: Math.min(rect.right + 10, window.innerWidth - 110), top: Math.max(20, Math.min(rect.top + rect.height / 2, window.innerHeight - 20)) });
  };
  const accountLabel = pendingUpdateVersion ? `本地用户 · 设置 · 可更新到 v${pendingUpdateVersion}` : '本地用户 · 设置';
  return (
    <>
    <div className="shell-navigation-rail">
    <nav className="shell-navigation-rail__items" aria-label="主导航">
      {navigation.map(({ stage: target, label, testId, Icon }) => (
        <button
          key={target}
          type="button"
          data-testid={testId}
          className={clsx('shell-navigation-rail__button text-text', stage === target && 'is-active')}
          aria-label={label}
          aria-describedby={tip?.label === label ? tooltipId : undefined}
          onMouseEnter={(event) => show(event.currentTarget, label)}
          onMouseLeave={() => setTip(undefined)}
          onFocus={(event) => show(event.currentTarget, label)}
          onBlur={() => setTip(undefined)}
          onKeyDown={(event) => { if (event.key === 'Escape') setTip(undefined); }}
          aria-current={stage === target ? 'page' : undefined}
          onClick={() => target === 'talk' ? onHome() : onSelectStage(target)}
        >
          <Icon size={18} />
        </button>
      ))}
    </nav>
    <div className="shell-navigation-rail__footer" data-testid="sidebar-settings-box">
      <button
        type="button"
        data-testid="nav-settings"
        className={clsx('shell-navigation-rail__button shell-navigation-rail__account', settingsOpen && 'is-active')}
        aria-label={accountLabel}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen ?? false}
        aria-describedby={tip?.label === accountLabel ? tooltipId : undefined}
        onMouseEnter={(event) => show(event.currentTarget, accountLabel)}
        onMouseLeave={() => setTip(undefined)}
        onFocus={(event) => show(event.currentTarget, accountLabel)}
        onBlur={() => setTip(undefined)}
        onKeyDown={(event) => { if (event.key === 'Escape') setTip(undefined); }}
        onClick={() => { setTip(undefined); onSelectStage('settings'); }}
      >
        <span aria-hidden="true">U</span>
        {pendingUpdateVersion && <span data-testid="sidebar-update-badge" className="shell-navigation-rail__update"><span className="sr-only">v{pendingUpdateVersion}</span></span>}
      </button>
    </div>
    </div>
    {tip && createPortal(<div id={tooltipId} role="tooltip" className="shell-navigation-rail__tooltip" style={{left:tip.left,top:tip.top}}>{tip.label}</div>, document.body)}
    </>
  );
}
