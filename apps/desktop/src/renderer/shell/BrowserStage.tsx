// 浏览器独立页（Stage）：左列 Profile 管理 + 右侧内嵌浏览器。
// 每个 Profile 一个独立 webview partition（独立 Cookie / 登录态，多账号并存）；
// 「默认浏览器」与右栏 BrowserPanel 共用 'persist:browser-panel'，共享登录态。
// 切换 Profile 通过 key 重建 BrowserPanel —— Electron webview 的 partition
// 挂载后不可动态修改。本页的 BrowserPanel 不注册 AI 操控单例
// （registerForAutomation=false），右栏实例保持唯一操控目标。
import { Check, Globe, Pencil, Plus, Trash2, User, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  createBrowserProfile,
  deleteBrowserProfile,
  profilePartition,
  readBrowserProfiles,
  renameBrowserProfile,
  type BrowserProfile,
} from '../browser-profiles.js';
import { BrowserPanel } from './BrowserPanel.js';

const NOOP = () => {};

export function BrowserStage(): JSX.Element {
  const [profiles, setProfiles] = useState<BrowserProfile[]>(() => readBrowserProfiles());
  /** null = 默认浏览器（与右栏共享登录态）。 */
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // 新建 Profile：行内输入框。
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  // 重命名：某一项进入编辑态。
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 删除二次确认：第一次点击进入待确认（变红），再次点击才真正删除。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (creating) newInputRef.current?.focus();
  }, [creating]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const commitCreate = useCallback(() => {
    const created = createBrowserProfile(newName);
    if (created) {
      setProfiles(readBrowserProfiles());
      setActiveProfileId(created.id);
    }
    setCreating(false);
    setNewName('');
  }, [newName]);

  const commitRename = useCallback(() => {
    if (renamingId) {
      setProfiles(renameBrowserProfile(renamingId, renameValue));
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue]);

  const handleDelete = useCallback(
    (id: string) => {
      if (confirmDeleteId !== id) {
        setConfirmDeleteId(id);
        return;
      }
      const next = deleteBrowserProfile(id);
      setProfiles(next);
      setConfirmDeleteId(null);
      // 删除当前选中的 Profile → 回落到默认浏览器。
      setActiveProfileId((current) => (current === id ? null : current));
    },
    [confirmDeleteId],
  );

  return (
    <div className="flex h-full min-h-0" data-testid="browser-stage">
      {/* 左列：Profile 管理 */}
      <div className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
        <div className="px-4 pb-2 pt-4">
          <div className="text-[15px] font-semibold text-text">浏览器</div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-text-faint">
            每个 Profile 拥有独立的 Cookie 和登录态，可管理多账号
          </div>
        </div>

        <div className="px-3 pb-2">
          {creating ? (
            <div className="flex items-center gap-1 rounded-lg border border-accent px-2 py-1.5">
              <input
                ref={newInputRef}
                data-testid="browser-profile-new-input"
                className="h-6 min-w-0 flex-1 bg-transparent text-[12.5px] text-text placeholder:text-text-faint focus:outline-none"
                placeholder="Profile 名称"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCreate();
                  if (event.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
              />
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-accent hover:bg-hover"
                title="创建"
                onClick={commitCreate}
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
                title="取消"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="browser-profile-new"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[12.5px] text-text-secondary hover:border-accent hover:text-accent"
              onClick={() => setCreating(true)}
            >
              <Plus size={13} />
              新建 Profile
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5 px-3 pb-4" data-testid="browser-profile-list">
          {/* 默认浏览器：固定第一项，与右栏浏览器共享登录态。 */}
          <button
            type="button"
            data-testid="browser-profile-item-default"
            className={clsx(
              'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left',
              activeProfileId === null
                ? 'border-accent bg-accent-soft'
                : 'border-border bg-surface hover:bg-hover',
            )}
            onClick={() => setActiveProfileId(null)}
          >
            <Globe size={16} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px] font-medium text-text">默认浏览器</span>
                <span className="shrink-0 rounded bg-accent-soft px-1 py-px text-[10px] text-accent-text">
                  默认
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-text-faint">与应用共享登录态</div>
            </div>
            <span className="shrink-0 text-[10.5px] text-accent-text">启用中</span>
          </button>

          {profiles.map((profile) => {
            const active = activeProfileId === profile.id;
            const renaming = renamingId === profile.id;
            const confirming = confirmDeleteId === profile.id;
            return (
              <div
                key={profile.id}
                data-testid={`browser-profile-item-${profile.id}`}
                className={clsx(
                  'group flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5',
                  active
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface hover:bg-hover',
                )}
                onClick={() => {
                  if (!renaming) setActiveProfileId(profile.id);
                }}
              >
                <User size={16} className="shrink-0 text-text-secondary" />
                {renaming ? (
                  <input
                    ref={renameInputRef}
                    data-testid={`browser-profile-rename-input-${profile.id}`}
                    className="h-6 min-w-0 flex-1 rounded border border-accent bg-transparent px-1.5 text-[12.5px] text-text focus:outline-none"
                    value={renameValue}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename();
                      if (event.key === 'Escape') {
                        setRenamingId(null);
                        setRenameValue('');
                      }
                    }}
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-text">{profile.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-text-faint">独立登录态</div>
                  </div>
                )}
                {active ? (
                  <span className="shrink-0 text-[10.5px] text-accent-text">启用中</span>
                ) : null}
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  {!renaming ? (
                    <button
                      type="button"
                      data-testid={`browser-profile-rename-${profile.id}`}
                      className="flex h-6 w-6 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
                      title="重命名"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmDeleteId(null);
                        setRenamingId(profile.id);
                        setRenameValue(profile.name);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`browser-profile-delete-${profile.id}`}
                    className={clsx(
                      'flex h-6 w-6 items-center justify-center rounded hover:bg-hover',
                      confirming ? 'text-error' : 'text-text-faint hover:text-text',
                    )}
                    title={confirming ? '再次点击确认删除' : '删除'}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDelete(profile.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右侧：内嵌浏览器。key 切换时强制重建 BrowserPanel（webview partition
          不能动态改）；registerForAutomation=false 让右栏实例独占 AI 操控。 */}
      <div className="min-w-0 flex-1">
        <BrowserPanel
          key={activeProfileId ?? 'default'}
          partition={profilePartition(activeProfileId)}
          registerForAutomation={false}
          embedded
          onClose={NOOP}
        />
      </div>
    </div>
  );
}
