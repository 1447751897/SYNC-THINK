// Right rail: Changes + tasks only (process lives in-message, not duplicated here).
// Changes panel is an editor-style preview aligned with NewMax.
import { useState } from 'react';
import { FileDiff, ListTodo, X } from 'lucide-react';
import type { RunProcessView } from '@sync-think/protocol';
import {
  CodePreview,
  UnifiedDiffPreview,
  actionLabel,
  fileName,
  isStatusOnlyPreview,
  looksLikeUnifiedDiff,
} from './ExecutionProcessBlock.js';

export type RailTab = 'changes' | 'tasks';

interface RightRailProps {
  conversationId: string | null;
  processView?: RunProcessView;
  activeTab?: RailTab | 'process';
  selectedChangePath?: string;
  onTabChange?: (tab: RailTab) => void;
  onSelectChangePath?: (path: string) => void;
  onClose(): void;
}

function normalizeTab(tab: RightRailProps['activeTab']): RailTab {
  return tab === 'tasks' ? 'tasks' : 'changes';
}

export function RightRail({
  processView,
  activeTab,
  selectedChangePath,
  onTabChange,
  onSelectChangePath,
  onClose,
}: RightRailProps) {
  const [innerTab, setInnerTab] = useState<RailTab>('changes');
  const tab = normalizeTab(activeTab ?? innerTab);
  const setTab = (next: RailTab) => {
    onTabChange?.(next);
    setInnerTab(next);
  };

  const fileChanges = processView?.fileChanges ?? [];
  const selected = selectedChangePath
    ? fileChanges.find((item) => item.path === selectedChangePath) ?? fileChanges[0]
    : fileChanges[0];

  return (
    <aside
      className="shell-right-rail flex w-[360px] shrink-0 flex-col border-l border-border bg-surface"
      data-testid="right-rail"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <RailTabBtn
          active={tab === 'changes'}
          icon={<FileDiff size={13} />}
          label="Changes"
          onClick={() => setTab('changes')}
        />
        <RailTabBtn
          active={tab === 'tasks'}
          icon={<ListTodo size={13} />}
          label="任务"
          onClick={() => setTab('tasks')}
        />
        <button
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
          onClick={onClose}
          title="关闭"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'changes' && (
          <div className="flex h-full min-h-0 flex-col">
            {fileChanges.length === 0 ? (
              <EmptyState
                icon={<FileDiff size={22} className="text-text-faint opacity-40" />}
                title="暂无文件变更"
                subtitle="AI 写入/修改文件后会显示在这里"
              />
            ) : (
              <>
                <div className="shell-rail-files shrink-0 border-b border-border px-2 py-2">
                  <div className="mb-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wide text-text-faint">
                    本轮改动 · {fileChanges.length}
                  </div>
                  <ul className="space-y-0.5">
                    {fileChanges.map((item) => {
                      const active = selected?.path === item.path;
                      return (
                        <li key={item.path}>
                          <button
                            type="button"
                            className={`shell-rail-file-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] ${
                              active
                                ? 'bg-accent-soft text-accent-text'
                                : 'text-text hover:bg-hover'
                            }`}
                            onClick={() => onSelectChangePath?.(item.path)}
                            title={item.path}
                          >
                            <span className={`shell-changes-card__badge is-${item.action}`}>
                              {item.action === 'created'
                                ? 'A'
                                : item.action === 'deleted'
                                  ? 'D'
                                  : 'M'}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {fileName(item.path)}
                            </span>
                            <span className="shrink-0 text-[10.5px] text-text-faint">
                              {actionLabel(item.action)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="shell-rail-editor flex min-h-0 flex-1 flex-col overflow-hidden">
                  {selected ? (
                    <>
                      <div className="shell-rail-editor__bar shrink-0">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12.5px] font-medium text-text">
                            {fileName(selected.path)}
                          </div>
                          <div className="truncate text-[11px] text-text-faint" title={selected.path}>
                            {selected.path}
                          </div>
                        </div>
                        <span className={`shell-changes-card__badge is-${selected.action}`}>
                          {selected.action === 'created'
                            ? 'A'
                            : selected.action === 'deleted'
                              ? 'D'
                              : 'M'}
                        </span>
                      </div>
                      <div className="shell-rail-editor__body min-h-0 flex-1 overflow-auto">
                        {!isStatusOnlyPreview(selected.preview) && selected.preview ? (
                          looksLikeUnifiedDiff(selected.preview) ? (
                            <UnifiedDiffPreview text={selected.preview} path={selected.path} />
                          ) : (
                            <CodePreview text={selected.preview} path={selected.path} />
                          )
                        ) : (
                          <div className="px-4 py-6 text-[12px] text-text-faint">
                            {selected.preview || '暂无内容预览；完整 diff 将在后续增强'}
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'tasks' && (
          <EmptyState
            icon={<ListTodo size={22} className="text-text-faint opacity-40" />}
            title="任务面板"
            subtitle="小队执行时的任务分工将在此显示"
          />
        )}
      </div>
    </aside>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon}
      <p className="text-[12px] text-text-faint">{title}</p>
      <p className="px-4 text-[11px] text-text-faint opacity-70">{subtitle}</p>
    </div>
  );
}

function RailTabBtn({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors ${
        active
          ? 'bg-accent-soft text-accent-text'
          : 'text-text-faint hover:bg-hover hover:text-text'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
