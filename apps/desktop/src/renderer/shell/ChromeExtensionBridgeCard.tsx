import * as Dialog from '@radix-ui/react-dialog';
import {
  Check,
  ChevronDown,
  Chrome,
  CircleAlert,
  Copy,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  DEFAULT_BROWSER_EXTENSION_STATUS,
  DEFAULT_BROWSER_EXTENSION_URL,
  normalizeBrowserExtensionStatus,
  type BrowserExtensionConnectionState,
  type BrowserExtensionStatus,
} from '../../browser-extension-contract.js';

type BrowserExtensionRuntime = NonNullable<
  NonNullable<Window['syncThink']>['runtime']
>['browserExtension'];

type CopyTarget = 'url' | 'token';

interface ChromeExtensionBridgeCardProps {
  runtime?: BrowserExtensionRuntime;
}

const STATUS_LABELS: Record<BrowserExtensionConnectionState, string> = {
  disabled: '未启用',
  connecting: '连接中',
  connected: '已连接',
  disconnected: '未连接',
  'version-mismatch': '版本不匹配',
  'authentication-failed': '配对失败',
  'protocol-mismatch': '协议不匹配',
};

const STATUS_HINTS: Record<BrowserExtensionConnectionState, string> = {
  disabled: 'Chrome 扩展桥接尚未启用。',
  connecting: '正在连接本机浏览器宿主。',
  connected: 'AI 可以通过 Chrome 执行浏览器操作。',
  disconnected: '浏览器扩展当前未连接到本机宿主。',
  'version-mismatch': '扩展版本与当前打包版本不一致。',
  'authentication-failed': '配对令牌无效，请重置配对后重试。',
  'protocol-mismatch': '扩展与宿主协议版本不兼容。',
};

export function ChromeExtensionBridgeCard(props: ChromeExtensionBridgeCardProps = {}): JSX.Element {
  const bridge = props.runtime ?? window.syncThink?.runtime?.browserExtension;
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [status, setStatus] = useState<BrowserExtensionStatus>(DEFAULT_BROWSER_EXTENSION_STATUS);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [copied, setCopied] = useState<CopyTarget>();
  const [resetOpen, setResetOpen] = useState(false);

  const readStatus = useCallback(async () => {
    if (!bridge) {
      setStatus(DEFAULT_BROWSER_EXTENSION_STATUS);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await bridge.status();
      setStatus(normalizeBrowserExtensionStatus(next));
      setError(undefined);
    } catch (nextError) {
      setStatus({
        ...DEFAULT_BROWSER_EXTENSION_STATUS,
        lastErrorCode: errorCode(nextError),
      });
      setError(extensionErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void readStatus();
  }, [readStatus]);

  const runStatusAction = useCallback(
    async (action: () => Promise<BrowserExtensionStatus>, successMessage?: string) => {
      if (!bridge) {
        setError('浏览器宿主尚未提供扩展桥接接口。');
        return;
      }
      setActionBusy(true);
      setError(undefined);
      setNotice(undefined);
      try {
        const next = await action();
        setStatus(normalizeBrowserExtensionStatus(next));
        if (successMessage) setNotice(successMessage);
      } catch (nextError) {
        setStatus((current) => ({
          ...current,
          hostAvailable: false,
          connected: false,
          state: 'disconnected',
          lastErrorCode: errorCode(nextError),
        }));
        setError(extensionErrorMessage(nextError));
      } finally {
        setActionBusy(false);
      }
    },
    [bridge],
  );

  const handleRetry = useCallback(() => {
    if (!bridge) {
      setError('浏览器宿主尚未提供扩展桥接接口。');
      return;
    }
    void runStatusAction(() => bridge.restart());
  }, [bridge, runStatusAction]);

  const handleResetPairing = useCallback(() => {
    if (!bridge) {
      setError('浏览器宿主尚未提供扩展桥接接口。');
      setResetOpen(false);
      return;
    }
    void runStatusAction(() => bridge.resetPairing(), '配对已重置。');
    setResetOpen(false);
  }, [bridge, runStatusAction]);

  const handleOpenFolder = useCallback(async () => {
    if (!bridge) {
      setError('浏览器宿主尚未提供扩展桥接接口。');
      return;
    }
    setActionBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await bridge.openFolder();
      if (!result?.success) {
        setError(result?.message || '扩展目录打开失败。');
      } else {
        setNotice('已打开扩展目录。');
      }
    } catch (nextError) {
      setError(extensionErrorMessage(nextError));
    } finally {
      setActionBusy(false);
    }
  }, [bridge]);

  const handleCopy = useCallback(async (target: CopyTarget, value: string) => {
    if (!value) return;
    if (!(await copyText(value))) {
      setError('复制失败，请手动选择并复制。');
      return;
    }
    setError(undefined);
    setNotice(target === 'url' ? 'WebSocket URL 已复制。' : '配对 Token 已复制。');
    setCopied(target);
    window.setTimeout(
      () => setCopied((current) => (current === target ? undefined : current)),
      1400,
    );
  }, []);

  const statusState = status.state;
  const statusLabel = loading ? '检查中' : STATUS_LABELS[statusState];
  const statusHint = loading ? '正在检查 Chrome 扩展桥接状态。' : STATUS_HINTS[statusState];
  const controlsBusy = loading || actionBusy || status.busy;
  const connectionInfo = status.connectionInfo;
  const bundledVersion = connectionInfo?.bundledVersion || '';
  const extensionUrl = connectionInfo?.url || DEFAULT_BROWSER_EXTENSION_URL;
  const token = connectionInfo?.token || '';
  const statusDetail = useMemo(() => {
    if (statusState === 'version-mismatch' && status.installedVersion) {
      return `已安装 ${status.installedVersion} · 打包 ${bundledVersion || '未知'}`;
    }
    if (status.lastErrorCode) return status.lastErrorCode;
    return undefined;
  }, [bundledVersion, status.installedVersion, status.lastErrorCode, statusState]);

  return (
    <section
      className={clsx('browser-extension-card', expanded && 'is-expanded')}
      data-testid="chrome-extension-bridge-card"
      data-state={statusState}
      aria-busy={controlsBusy}
    >
      <button
        type="button"
        className="browser-extension-card__header"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="browser-extension-card__icon" data-testid="chrome-extension-icon">
          <Chrome size={17} strokeWidth={1.8} />
        </span>
        <span data-testid="chrome-extension-identity">
          <strong data-testid="chrome-extension-title">Chrome 扩展</strong>
          <span data-testid="chrome-extension-description">{statusHint}</span>
        </span>
        <span className="browser-extension-card__status" data-testid="chrome-extension-status">
          {loading ? <LoaderCircle className="animate-spin" size={12} /> : null}
          {statusLabel}
        </span>
        <ChevronDown size={15} className={clsx(expanded && 'is-expanded')} aria-hidden="true" />
      </button>

      {expanded ? (
        <div className="browser-extension-card__body">
          <div className="browser-extension-card__install">
            <div className="browser-extension-card__install-icon" aria-hidden="true">
              <KeyRound size={14} />
            </div>
            <div>
              <strong data-testid="chrome-extension-install-title">安装 Chrome 扩展</strong>
              <span data-testid="chrome-extension-install-description">
                在 Chrome 的“扩展程序”页面开启开发者模式，然后加载已解压的扩展目录。
              </span>
            </div>
          </div>

          <div className="browser-extension-card__body-actions">
            <button
              type="button"
              className="browser-extension-card__action"
              data-testid="chrome-extension-open-folder"
              disabled={controlsBusy}
              onClick={() => void handleOpenFolder()}
            >
              <FolderOpen size={13} />
              打开扩展目录
              <ExternalLink size={11} aria-hidden="true" />
            </button>
          </div>

          <div className="browser-extension-card__fields">
            <label>
              <span>WebSocket URL</span>
              <div className="browser-extension-card__field">
                <input
                  data-testid="chrome-extension-url"
                  value={extensionUrl}
                  readOnly
                  spellCheck={false}
                  aria-label="WebSocket URL"
                />
                <button
                  type="button"
                  className="browser-extension-card__copy"
                  aria-label="复制 WebSocket URL"
                  title="复制 WebSocket URL"
                  disabled={!extensionUrl || controlsBusy}
                  onClick={() => void handleCopy('url', extensionUrl)}
                >
                  {copied === 'url' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </label>
            <label>
              <span>配对 Token</span>
              <div className="browser-extension-card__field">
                <input
                  data-testid="chrome-extension-token"
                  type="password"
                  value={token}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="配对 Token"
                />
                <button
                  type="button"
                  className="browser-extension-card__copy"
                  aria-label="复制配对 Token"
                  title="复制配对 Token"
                  disabled={!token || controlsBusy}
                  onClick={() => void handleCopy('token', token)}
                >
                  {copied === 'token' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </label>
          </div>

          {statusDetail ? (
            <div className="browser-extension-card__detail">
              <CircleAlert size={13} />
              <span>{statusDetail}</span>
            </div>
          ) : null}
          {error ? (
            <div className="browser-extension-card__message is-error" role="alert">
              <CircleAlert size={13} />
              <span>{error}</span>
            </div>
          ) : null}
          {notice ? (
            <div className="browser-extension-card__message is-success" role="status">
              <Check size={13} />
              <span>{notice}</span>
            </div>
          ) : null}

          <div className="browser-extension-card__footer">
            <button
              type="button"
              className="browser-extension-card__action browser-extension-card__action--primary"
              data-testid="chrome-extension-retry"
              disabled={controlsBusy}
              onClick={handleRetry}
            >
              <RefreshCw className={clsx(actionBusy && 'animate-spin')} size={13} />
              重试连接
            </button>
            <Dialog.Root open={resetOpen} onOpenChange={setResetOpen}>
              <Dialog.Trigger asChild>
                <button
                  type="button"
                  className="browser-extension-card__action browser-extension-card__action--quiet"
                  data-testid="chrome-extension-reset"
                  disabled={controlsBusy}
                >
                  <RotateCcw size={13} />
                  重置配对
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="browser-extension-card__dialog-overlay" />
                <Dialog.Content
                  className="browser-extension-card__dialog"
                  aria-describedby="chrome-extension-reset-description"
                >
                  <Dialog.Title>重置 Chrome 扩展配对？</Dialog.Title>
                  <Dialog.Description id="chrome-extension-reset-description">
                    这会清除当前配对 Token。扩展需要重新连接本机宿主才能继续工作。
                  </Dialog.Description>
                  <div className="browser-extension-card__dialog-actions">
                    <Dialog.Close asChild>
                      <button type="button" className="browser-extension-card__action">
                        取消
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      className="browser-extension-card__action browser-extension-card__action--danger"
                      data-testid="chrome-extension-reset-confirm"
                      disabled={controlsBusy}
                      onClick={handleResetPairing}
                    >
                      <RotateCcw size={13} />
                      重置配对
                    </button>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="browser-extension-card__dialog-close"
                      aria-label="关闭重置配对确认框"
                    >
                      <X size={14} />
                    </button>
                  </Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy clipboard path for older Electron builds.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error || '');
  const match = /(?:code|error)[:=\s]+([a-z0-9_.-]+)/i.exec(message);
  return match?.[1] || null;
}

function extensionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/timed out|timeout/i.test(message)) return '浏览器宿主响应超时，请确认扩展和宿主都已启动。';
  if (/authentication|pairing|token/i.test(message)) return '扩展配对失败，请重置配对后重试。';
  if (/protocol|version/i.test(message)) return '扩展协议版本不匹配，请更新扩展或宿主。';
  return message || '浏览器扩展桥接操作失败。';
}
