import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  PackageCheck,
  RefreshCw,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  DesktopUpdateActionResult,
  DesktopUpdatePhase,
} from '../../desktop-update-contract.js';
import { PENDING_UPDATE_PHASES, useDesktopUpdateState } from './use-desktop-update-state.js';
import syncThinkLogo from './assets/sync-think-logo.png';

const PHASE_LABELS: Record<DesktopUpdatePhase, string> = {
  disabled: '更新通道未启用',
  idle: '等待检查更新',
  checking: '正在检查更新…',
  available: '发现可用更新',
  'up-to-date': '当前已是最新版本',
  downloading: '正在下载安装包…',
  downloaded: '安装包已就绪',
  installing: '正在安全退出并启动安装…',
  error: '更新操作需要处理',
};

const ERROR_LABELS: Record<string, string> = {
  'desktop.update.feed-invalid': '更新通道地址配置无效。',
  'desktop.update.channel-invalid': '更新通道名称配置无效。',
  'desktop.update.token-invalid': '更新通道凭据配置无效。',
  'desktop.update.dev-disabled': '开发构建未显式允许更新测试。',
  'desktop.update.check-failed': '检查更新失败，请稍后重试。',
  'desktop.update.download-failed': '更新下载失败，请重新下载。',
  'desktop.update.channel-unavailable': '更新通道暂不可用，请检查发布通道。',
  'desktop.update.metadata-invalid': '更新元数据无效，已停止本次更新。',
  'desktop.update.checksum-mismatch': '安装包校验失败，已丢弃本次下载。',
  'desktop.update.install-failed': '安装准备失败，请重启应用后重试。',
  'desktop.update.provider-failed': '更新服务返回异常。',
  'desktop.update.action-busy': '已有更新操作正在进行。',
  'desktop.update.action-invalid': '当前状态不允许执行该操作。',
  'desktop.update.disabled': '当前 Beta 为手动下载，未配置自动更新通道。',
  'desktop.update.initialization-failed': '更新组件初始化失败。',
};

type UpdateAction = () => Promise<DesktopUpdateActionResult>;
type UpdateActionKind = 'check' | 'download' | 'install';

/** 「更新内容」区块只在存在可安装版本时出现，与侧边栏版本提示共用阶段判断。 */
const RELEASE_NOTES_PHASES = PENDING_UPDATE_PHASES;

interface ReleaseHistoryEntry {
  version: string;
  date: string;
  notes: string;
}

/**
 * 解析构建期固化的历史更新日志，任何异常都退回空数组 —— 日志是锦上添花，
 * 不该因为它取不到就把整个弹窗带崩。逐项校验字段：注入内容虽然是自家构建产物，
 * 但渲染层对日志一视同仁地只接受纯文本，不信任任何结构。
 */
function parseReleaseHistory(raw: string): ReleaseHistoryEntry[] {
  if (raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const history: ReleaseHistoryEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const { version, date, notes } = item as Record<string, unknown>;
    if (typeof version !== 'string' || version.length === 0) continue;
    if (typeof notes !== 'string' || notes.trim().length === 0) continue;
    history.push({ version, date: typeof date === 'string' ? date : '', notes });
  }
  return history;
}

/**
 * 全部历史版本的更新日志，构建期由 scripts/build-shell.mjs 从
 * docs/releases/CHANGELOG.md 解析后固化进产物，顺序沿用 CHANGELOG 的倒序（新 → 旧）。
 *
 * 更新源只在「有可安装版本」时携带 releaseNotes、且只带当前发布的那一版，所以光靠
 * 更新源，用户永远只看得到「即将升到的那版」或「刚装上的那版」，翻不到历史。
 * 这一份让弹窗在任何阶段都能回看全部版本。测试环境没有注入该常量，
 * 故用 `typeof` 守卫取值而不是直接引用。
 */
const RELEASE_HISTORY: ReleaseHistoryEntry[] = parseReleaseHistory(
  typeof __SYNC_THINK_RELEASE_HISTORY__ === 'string' ? __SYNC_THINK_RELEASE_HISTORY__ : '',
);

/**
 * Release notes are plain text: the Main process strips control characters and
 * caps the length before sending them. Rendering line by line keeps the shape
 * of simple lists and headings without ever passing anything to
 * `dangerouslySetInnerHTML`, so a compromised feed cannot inject markup.
 */
function renderReleaseNotes(notes: string) {
  const lines = notes.split('\n');
  // 版本摘要就是第一个非空行。CHANGELOG 的约定里它排在版本标题之后、第一个
  // `### 分段` 之前，scripts/changelog.mjs 渲染时把它当裸文本行放在最前面
  // （不加 `>` 前缀），所以只能靠「位置 + 不带任何标记」来认出它。
  // 认出后单独给一层样式，让「这一版在说什么」和下面的条目清单区分开。
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  return lines.map((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0) return null;
    // CHANGELOG 的「格式约定」把 `1. ` 与 `- ` 并列为一个条目
    // （见 docs/releases/CHANGELOG.md）。两者都渲染成两列 grid：标记占第一列、
    // 正文占第二列，折行后自动对齐文字列，而不是顶回左边缘变成一坨。
    const ordered = /^(\d+)[.)]\s+/.exec(line);
    if (ordered) {
      return (
        <div key={index} className="settings-about-release-notes__item">
          <span className="settings-about-release-notes__marker">{ordered[1]}.</span>
          <span>{line.slice(ordered[0].length)}</span>
        </div>
      );
    }
    const bullet = /^[-*•]\s+/.exec(line);
    if (bullet) {
      return (
        <div key={index} className="settings-about-release-notes__item">
          <span className="settings-about-release-notes__marker" aria-hidden="true">
            •
          </span>
          <span>{line.slice(bullet[0].length)}</span>
        </div>
      );
    }
    const heading = /^#{1,6}\s+/.exec(line);
    if (heading) {
      return (
        <p key={index} className="settings-about-release-notes__heading">
          {line.slice(heading[0].length)}
        </p>
      );
    }
    // 走到这里说明这行既不是列表也不是分段标题；只有它是第一个非空行时才算摘要。
    // 顺手兼容更新源直接给 `> 摘要` 的写法（随包日志不带这个前缀）。
    if (index === firstContentIndex) {
      const quoted = /^>\s?(.*)$/.exec(line);
      const summary = (quoted ? quoted[1] : line).trim();
      if (summary.length > 0) {
        return (
          <p key={index} className="settings-about-release-notes__summary">
            {summary}
          </p>
        );
      }
    }
    return (
      <p key={index} className="settings-about-release-notes__line">
        {line}
      </p>
    );
  });
}

const DIALOG_FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 更新日志弹窗。
 *
 * 纯展示：正文复用 `renderReleaseNotes` 的行级渲染，所以日志里的任何字符都只能是文本，
 * 不会变成标记。可访问性上做三件事——Esc 关闭、Tab 焦点锁在弹窗内、关闭后把焦点还给
 * 触发它的按钮。
 */
function ReleaseNotesDialog({
  version,
  pendingNotes,
  history,
  currentVersion,
  onClose,
}: {
  version: string | null;
  /** 更新源为「即将升到的那版」提供的日志，没有可安装版本时为 null。 */
  pendingNotes: { version: string; notes: string } | null;
  /** 随包固化的全部历史版本，新 → 旧。 */
  history: ReleaseHistoryEntry[];
  currentVersion: string | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="settings-about-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={version ? `v${version} 更新日志` : '更新日志'}
        className="settings-about-dialog"
      >
        <div className="settings-about-dialog__header">
          {/* 头部给一个视觉锚点：NewMax 的弹窗标题带一枚圆形图标，
              原先这里只有两行纯文字（eyebrow + 版本号），开起来是空的。 */}
          <div className="settings-about-dialog__identity">
            <span className="settings-about-dialog__icon" aria-hidden="true">
              <RefreshCw size={20} />
            </span>
            <div>
              <h3 className="settings-about-dialog__title">更新日志</h3>
              <span className="settings-about-dialog__version">
                {version ? `v${version}` : '本次更新'}
              </span>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-about-dialog__close"
            aria-label="关闭更新日志"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="settings-about-dialog__body">
          {/*
            待更新版本置顶：点开弹窗时用户最先想知道的是「升上去会得到什么」，
            历史版本跟在后面按版本倒序排。两处都用同一套渲染，靠版本头右侧的
            标记（待更新 / 当前版本）区分，而不是换一种排版。
          */}
          {pendingNotes ? (
            <section className="settings-about-release-notes__entry is-pending">
              <div className="settings-about-release-notes__entry-head">
                <span className="settings-about-release-notes__entry-version">
                  v{pendingNotes.version}
                </span>
                <span className="settings-about-release-notes__entry-badge">待更新</span>
              </div>
              {renderReleaseNotes(pendingNotes.notes)}
            </section>
          ) : null}

          {history.map((entry) => (
            <section
              key={entry.version}
              className={clsx(
                'settings-about-release-notes__entry',
                entry.version === currentVersion && 'is-current',
              )}
            >
              <div className="settings-about-release-notes__entry-head">
                <span className="settings-about-release-notes__entry-version">v{entry.version}</span>
                {entry.date.length > 0 ? (
                  <span className="settings-about-release-notes__entry-date">{entry.date}</span>
                ) : null}
                {entry.version === currentVersion ? (
                  <span className="settings-about-release-notes__entry-badge">当前版本</span>
                ) : null}
              </div>
              {renderReleaseNotes(entry.notes)}
            </section>
          ))}

          {!pendingNotes && history.length === 0 ? (
            <p className="settings-about-release-notes__empty">暂无可查看的更新日志。</p>
          ) : null}
        </div>
        {/*
          NewMax 的 WhatsNewDialog 在页脚放一个右对齐的主按钮（t('app.gotIt') =「知道了」），
          而不是只靠右上角的 ×。补上它让弹窗有明确的收尾动作，交互上与 NewMax 一致。
          注意这是纯展示按钮，不改变 aria-label 与 Esc/焦点锁行为。
        */}
        <div className="settings-about-dialog__footer">
          <button type="button" className="settings-about-dialog__confirm" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

export function DesktopUpdatePanel() {
  const { snapshot, loadFailed, applySnapshot } = useDesktopUpdateState();
  const [pendingAction, setPendingAction] = useState<UpdateActionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [auxiliaryError, setAuxiliaryError] = useState<string | null>(null);
  const [autoCheck, setAutoCheck] = useState(true);
  const [autoCheckBusy, setAutoCheckBusy] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);

  // 快照由共享 hook 订阅；自动检查偏好只影响本面板，就地读一次。
  useEffect(() => {
    const bridge = window.syncThink?.updates;
    if (!bridge) return;
    let active = true;
    void bridge
      .getAutoCheck()
      .then((preference) => {
        if (active) setAutoCheck(preference.enabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // 快照都读不到时，把失败翻成一个 renderer 安全的错误码，而不是继续显示「检查中」。
  useEffect(() => {
    if (loadFailed) setActionError('desktop.update.initialization-failed');
  }, [loadFailed]);

  async function runAction(kind: UpdateActionKind, action: UpdateAction) {
    setPendingAction(kind);
    setActionError(null);
    try {
      const result = await action();
      applySnapshot(result.state);
      setActionError(result.errorCode);
    } catch {
      setActionError(`desktop.update.${kind}-failed`);
    } finally {
      setPendingAction(null);
    }
  }

  async function changeAutoCheck(enabled: boolean) {
    const bridge = window.syncThink?.updates;
    if (!bridge || autoCheckBusy) return;
    setAutoCheckBusy(true);
    setAuxiliaryError(null);
    try {
      const preference = await bridge.setAutoCheck({ enabled });
      setAutoCheck(preference.enabled);
    } catch {
      setAuxiliaryError('保存自动更新偏好失败。');
    } finally {
      setAutoCheckBusy(false);
    }
  }

  async function openLogDirectory() {
    const bridge = window.syncThink?.updates;
    if (!bridge) return;
    setAuxiliaryError(null);
    try {
      const result = await bridge.openLogDirectory();
      if (!result.opened) setAuxiliaryError('打开日志目录失败。');
    } catch {
      setAuxiliaryError('打开日志目录失败。');
    }
  }

  const bridge = window.syncThink?.updates;
  const phase = snapshot?.phase;
  const configured = snapshot?.configured === true;
  const canCheck =
    configured &&
    pendingAction === null &&
    phase !== 'checking' &&
    phase !== 'downloading' &&
    phase !== 'downloaded' &&
    phase !== 'installing';
  const canDownload = configured && pendingAction === null && phase === 'available';
  const canInstall = configured && pendingAction === null && phase === 'downloaded';
  const visibleError = actionError ?? snapshot?.errorCode ?? null;
  const statusLabel = snapshot
    ? snapshot.phase === 'available' && snapshot.availableVersion
      ? `发现新版本 ${snapshot.availableVersion}`
      : snapshot.phase === 'downloading' && snapshot.progressPercent !== null
        ? `正在下载安装包 ${snapshot.progressPercent.toFixed(1)}%`
        : PHASE_LABELS[snapshot.phase]
    : '正在读取更新状态…';

  const primaryAction: UpdateActionKind =
    phase === 'downloaded' || phase === 'installing'
      ? 'install'
      : phase === 'available' || phase === 'downloading'
        ? 'download'
        : 'check';
  const primaryEnabled =
    primaryAction === 'install'
      ? canInstall
      : primaryAction === 'download'
        ? canDownload
        : canCheck;
  const primaryLabel =
    primaryAction === 'install'
      ? pendingAction === 'install' || phase === 'installing'
        ? '正在重启…'
        : '重启并安装'
      : primaryAction === 'download'
        ? pendingAction === 'download' || phase === 'downloading'
          ? '下载中…'
          : snapshot?.availableVersion
            ? `更新到 v${snapshot.availableVersion}`
            : '下载更新'
        : pendingAction === 'check' || phase === 'checking'
          ? '检查中…'
          : '检查更新';
  const PrimaryIcon =
    primaryAction === 'install'
      ? PackageCheck
      : primaryAction === 'download'
        ? Download
        : RefreshCw;

  // 更新源为「即将升到的那版」提供日志时，把它置顶；历史版本由随包固化的
  // RELEASE_HISTORY 提供 —— 两者互不替代，而不是二选一。
  const pendingReleaseNotes = (snapshot?.releaseNotes ?? '').trim();
  const showsPendingNotes = pendingReleaseNotes.length > 0 && Boolean(snapshot?.availableVersion);
  const dialogVersion = showsPendingNotes
    ? (snapshot?.availableVersion ?? null)
    : (snapshot?.currentVersion ?? null);
  const pendingDialogNotes =
    showsPendingNotes && dialogVersion !== null
      ? { version: dialogVersion, notes: pendingReleaseNotes }
      : null;

  const runPrimaryAction = () => {
    if (!bridge) return;
    if (primaryAction === 'install') {
      void runAction('install', () => bridge.installUpdate());
      return;
    }
    if (primaryAction === 'download') {
      void runAction('download', () => bridge.downloadUpdate());
      return;
    }
    void runAction('check', () => bridge.checkForUpdates());
  };

  return (
    <section className="settings-about-release" aria-label="关于 SYNC-THINK">
      <div className="settings-about-brand">
        <div className="settings-about-brand__line">
          <img
            src={syncThinkLogo}
            alt=""
            draggable={false}
            className="sync-think-logo settings-about-brand__mark"
          />
          <h2>SYNC-THINK</h2>
        </div>
        <p>版本 v{snapshot?.currentVersion ?? '读取中'}</p>
      </div>

      <div className="settings-about-update">
        <div className="settings-about-auto-check">
          <div>
            <strong>自动检查更新</strong>
            <span>{configured ? '启动时自动检查新版本' : '当前 Beta 为手动下载，不会自动检查更新'}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="自动检查更新"
            aria-checked={autoCheck}
            disabled={!bridge || autoCheckBusy}
            className={clsx('settings-about-toggle', autoCheck && 'is-checked')}
            onClick={() => void changeAutoCheck(!autoCheck)}
          >
            <span />
          </button>
        </div>

        <button
          type="button"
          className="settings-about-update__primary"
          disabled={!primaryEnabled || !bridge}
          onClick={runPrimaryAction}
        >
          <PrimaryIcon
            size={15}
            className={pendingAction === primaryAction ? 'is-spinning' : undefined}
            aria-hidden="true"
          />
          {primaryLabel}
        </button>

        {snapshot?.phase === 'downloading' && snapshot.progressPercent !== null ? (
          <div
            className="settings-about-progress"
            role="progressbar"
            aria-label="更新下载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={snapshot.progressPercent}
          >
            <span style={{ width: `${Math.min(100, Math.max(0, snapshot.progressPercent))}%` }} />
          </div>
        ) : null}

        {phase && phase !== 'idle' && phase !== 'error' ? (
          <p className="settings-about-update__status" aria-live="polite">
            {phase === 'disabled' ? '当前 Beta 为手动下载，未配置自动更新通道。' : statusLabel}
          </p>
        ) : null}

        {visibleError ? (
          <div className="settings-about-alert" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{ERROR_LABELS[visibleError] ?? '更新操作失败，请稍后重试。'}</span>
          </div>
        ) : null}

        {phase !== undefined && RELEASE_NOTES_PHASES.has(phase) ? (
          <div className="settings-about-release-notes" aria-label="更新内容">
            <p className="settings-about-release-notes__title">更新内容</p>
            {snapshot?.releaseNotes ? (
              <div className="settings-about-release-notes__body">
                {renderReleaseNotes(snapshot.releaseNotes)}
              </div>
            ) : (
              <p className="settings-about-release-notes__empty">本次更新未提供更新日志。</p>
            )}
          </div>
        ) : null}

        <div className="settings-about-links">
          <button type="button" onClick={() => setReleaseNotesOpen(true)}>
            <FileText size={15} aria-hidden="true" />
            查看更新日志
          </button>
          <button type="button" onClick={() => void openLogDirectory()}>
            <ExternalLink size={15} aria-hidden="true" />
            打开日志目录
          </button>
        </div>

        {auxiliaryError ? (
          <p className="settings-about-auxiliary-error" role="alert">
            {auxiliaryError}
          </p>
        ) : null}
      </div>

      {releaseNotesOpen ? (
        <ReleaseNotesDialog
          version={dialogVersion}
          pendingNotes={pendingDialogNotes}
          history={RELEASE_HISTORY}
          currentVersion={snapshot?.currentVersion ?? null}
          onClose={() => setReleaseNotesOpen(false)}
        />
      ) : null}
    </section>
  );
}
