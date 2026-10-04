import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import type { BrowserProfileSummary } from '@sync-think/protocol';
import './TaskExperience.css';

export function ProfileCreateDialog({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(profile: BrowserProfileSummary): void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (!name.trim() || busy) return;
    const api = window.syncThink?.runtime;
    if (!api?.createBrowserProfile) {
      setError('浏览器账号服务尚未连接，请重连 Runtime 后重试。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.createBrowserProfile({ name: name.trim() });
      onCreated(result.profile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-profile-backdrop" />
        <Dialog.Content
          className="task-profile-dialog"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <header>
            <div>
              <Dialog.Title>新建浏览器账号 Profile</Dialog.Title>
              <Dialog.Description>
                独立保存 Cookie 与登录态；当前任务草稿会保留。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭账号创建" disabled={busy}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              账号环境名称
              <input
                autoFocus
                aria-label="Profile 名称"
                maxLength={80}
                value={name}
                placeholder="如：淘宝工作账号"
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="task-experience-note">
              创建环境不等于已登录。网站要求登录时，任务会等待你接管；登录后复用同一个
              Profile。账号与站点会话可在「浏览器 → 账号管理」中查看。
            </p>
            {error && (
              <p role="alert" className="task-experience-error">
                {error}
              </p>
            )}
            <footer>
              <button type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="is-primary" disabled={busy || !name.trim()}>
                {busy && <LoaderCircle size={14} className="shell-process-spin" />}创建并绑定
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
