// P7/P8 · Settings Page
// Strictly follows the NewMax settings information architecture shown in the
// product reference screenshots: searchable left navigation, compact rows,
// page-local tabs, and a fixed completion action.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaemonCard } from './DaemonCard.js';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CircleUserRound,
  Copy,
  Database,
  Download,
  Info,
  Keyboard,
  Mic2,
  Monitor,
  Moon,
  Network,
  Palette,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import clsx from 'clsx';
import syncThinkLogo from './assets/sync-think-logo.png';
import {
  COMPUTER_USE_PLUGIN_SETTING_KEY,
  normalizeComputerUsePluginSetting,
} from '@sync-think/protocol/plugins';
// Subpath import on purpose: the protocol barrel reaches node:os / node:crypto
// through the pipe + handshake modules, which cannot be bundled for the renderer.
import {
  OPEN_GATEWAY_SETTING_KEY,
  normalizeOpenGatewaySetting,
  type GatewayLogsFilter,
  type GatewayRequestLogEntry,
  type OpenGatewaySetting,
  type OpenGatewayStatusResponse,
  type OpenGatewayUpstreamProtocol,
} from '@sync-think/protocol/gateway';
import { ModelSettings, type ModelSettingsHandle } from './ModelSettings.js';
import { DesktopUpdatePanel } from './DesktopUpdatePanel.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo } from './brand-icons.js';
import { decideSettingsPageAction } from './settings-unsaved.js';
import {
  readDefaultPermission,
  readUserName,
  writeDefaultPermission,
  writeUserName,
  USER_NAME_MAX_LENGTH,
  type DefaultPermissionPreference,
} from '../ui-preferences.js';

type ThemeMode = 'system' | 'light' | 'dark';
type SettingsSection =
  | 'account'
  | 'wallet'
  | 'organization'
  | 'general'
  | 'theme'
  | 'shortcuts'
  | 'models'
  | 'voice'
  | 'insights'
  | 'connection'
  | 'security'
  | 'plugins'
  | 'data'
  | 'about';
type PermissionDefault = DefaultPermissionPreference;

const THEME_KEY = 'sync-think-shell-theme';

function readStoredTheme(): ThemeMode {
  return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'system';
}

export function applyShellTheme(mode: ThemeMode): void {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(THEME_KEY, mode);
  // Mirror onto the native frame. Without this the OS title bar keeps whatever
  // the system resolved and light mode shows a dark strip above the window.
  void window.syncThink?.runtime?.setTheme?.(mode);
  window.dispatchEvent(new CustomEvent('shell-theme-applied', { detail: { mode, dark } }));
}

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Palette;
  ready: boolean;
  keywords?: string;
}> = [
  { id: 'account', label: '账号', icon: CircleUserRound, ready: false },
  { id: 'wallet', label: '钱包', icon: WalletCards, ready: false },
  { id: 'organization', label: '组织', icon: UsersRound, ready: false },
  { id: 'general', label: '通用', icon: Settings, ready: true, keywords: '动画 权限 个性化' },
  { id: 'theme', label: '主题', icon: Palette, ready: true, keywords: '浅色 深色 外观' },
  { id: 'shortcuts', label: '快捷键', icon: Keyboard, ready: false },
  {
    id: 'models',
    label: '模型',
    icon: Bot,
    ready: true,
    keywords: '供应商 API 密钥 CC Switch 使用统计',
  },
  { id: 'voice', label: '语音模型', icon: Mic2, ready: false },
  { id: 'insights', label: '每日回顾', icon: BarChart3, ready: false },
  {
    id: 'connection',
    label: '连接',
    icon: Plug,
    ready: true,
    keywords: 'AI 模型网关 协议转换 Claude Code Codex 反向代理 baseUrl 端口 /v1/models',
  },
  { id: 'security', label: '安全查杀', icon: ShieldCheck, ready: false },
  {
    id: 'plugins',
    label: '插件',
    icon: Sparkles,
    ready: true,
    keywords: 'Computer Use 桌面 UIA 自动化',
  },
  {
    id: 'data',
    label: '数据',
    icon: Database,
    ready: true,
    keywords: '诊断 导出 隐私 崩溃 恢复 日志',
  },
  { id: 'about', label: '关于', icon: Info, ready: true },
];

export interface SettingsPageProps {
  onDone?(): void;
  onCatalogChanged?(): void;
  onDirtyChange?(dirty: boolean): void;
}

export function SettingsPage({ onDone, onCatalogChanged, onDirtyChange }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>('general');
  const [query, setQuery] = useState('');
  const [modelDirty, setModelDirty] = useState(false);
  const [completing, setCompleting] = useState(false);
  const modelSettingsRef = useRef<ModelSettingsHandle | null>(null);

  const reportDirty = useCallback((dirty: boolean) => {
    setModelDirty(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);

  const handleDone = async () => {
    if (completing) return;
    // When on the models page, force connectivity test before close/save.
    if (section === 'models' && modelSettingsRef.current) {
      setCompleting(true);
      try {
        const ok = await modelSettingsRef.current.complete();
        if (!ok) return;
        reportDirty(false);
      } finally {
        setCompleting(false);
      }
    }
    onDone?.();
  };

  const visibleSections = useMemo(() => {
    const value = query.trim().toLocaleLowerCase('zh-CN');
    if (!value) return SECTIONS;
    return SECTIONS.filter((item) =>
      `${item.label} ${item.keywords ?? ''}`.toLocaleLowerCase('zh-CN').includes(value),
    );
  }, [query]);

  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[3];
  const fullBleed = section === 'models';

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-sidebar__header">
          <span>设置</span>
          <kbd>Ctrl ,</kbd>
        </div>
        <label className="settings-search">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            aria-label="搜索设置"
          />
        </label>
        <nav className="settings-nav" aria-label="设置分类">
          {visibleSections.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  const decision = decideSettingsPageAction(
                    {
                      kind: 'select-section',
                      currentSection: section,
                      nextSection: item.id,
                    },
                    modelDirty,
                    (message) => confirm(message),
                  );
                  if (decision.kind !== 'select-section') return;
                  if (decision.discardChanges) reportDirty(false);
                  setSection(decision.section as SettingsSection);
                }}
                className={clsx('settings-nav__item', active && 'is-active')}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
          {visibleSections.length === 0 ? (
            <p className="settings-nav__empty">没有匹配的设置</p>
          ) : null}
        </nav>
      </aside>

      <section className={clsx('settings-content', fullBleed && 'is-full-bleed')}>
        <div className="settings-content__topbar">
          <h1>{current.label}</h1>
        </div>
        <div className="settings-content__viewport">
          {section === 'general' && <GeneralSection />}
          {section === 'theme' && <ThemeSection />}
          {section === 'models' && (
            <ModelSettings
              ref={modelSettingsRef}
              onCatalogChanged={onCatalogChanged}
              onDirtyChange={reportDirty}
            />
          )}
          {section === 'plugins' && <ComputerUsePluginSection />}
          {section === 'connection' && <ConnectionSection />}
          {section === 'data' && <DataDiagnosticsSection />}
          {section === 'about' && <AboutSection />}
          {!current.ready && <ComingSoonSection label={current.label} />}
        </div>
        <footer className="settings-footer">
          <button
            type="button"
            className="settings-done"
            disabled={completing}
            onClick={() => void handleDone()}
          >
            {completing ? '测试连接中…' : '完成'}
          </button>
        </footer>
      </section>
    </div>
  );
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: 'light', label: '浅色', icon: Sun },
  { mode: 'dark', label: '深色', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor },
];

function ThemeSection() {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  const handleSelect = (mode: ThemeMode) => {
    setTheme(mode);
    applyShellTheme(mode);
  };

  return (
    <div className="settings-scroll settings-standard-pane">
      <section className="settings-block">
        <h2>外观</h2>
        <div className="settings-theme-grid" role="radiogroup" aria-label="外观主题">
          {THEME_OPTIONS.map(({ mode, label, icon: Icon }) => {
            const active = theme === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleSelect(mode)}
                className={clsx('settings-theme-option', active && 'is-active')}
              >
                <ThemePreview mode={mode} />
                <span className="settings-theme-option__label">
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </span>
                {active ? <Check size={14} className="settings-theme-check" /> : null}
              </button>
            );
          })}
        </div>
      </section>
      <p className="settings-note">主题切换会立即生效，并在下次启动时保留。</p>
    </div>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <div className={clsx('settings-theme-preview', isDark && 'is-dark')} aria-hidden="true">
      <span className="settings-theme-preview__sidebar" />
      <span className="settings-theme-preview__line is-long" />
      <span className="settings-theme-preview__line" />
    </div>
  );
}

const PERMISSION_OPTIONS: Array<{
  value: PermissionDefault;
  label: string;
  desc: string;
}> = [
  { value: 'ask', label: '询问批准', desc: '执行工具前先询问你' },
  { value: 'workspace', label: '为我批准', desc: '在工作区内自动执行' },
  { value: 'full-access', label: '完全访问', desc: '直接执行并保留审计记录' },
];

function GeneralSection() {
  const [tab, setTab] = useState<'general' | 'personal'>('general');
  const [permission, setPermission] = useState<PermissionDefault>(() => readDefaultPermission());
  const [animationEnabled, setAnimationEnabled] = useState<boolean>(() => {
    const stored = localStorage.getItem('sync-think-animation');
    return stored === null ? true : stored === '1';
  });

  const handlePermission = (value: PermissionDefault) => {
    setPermission(value);
    writeDefaultPermission(value);
  };

  const handleAnimation = (enabled: boolean) => {
    setAnimationEnabled(enabled);
    localStorage.setItem('sync-think-animation', enabled ? '1' : '0');
    document.documentElement.toggleAttribute('data-reduced-motion', !enabled);
  };

  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-segmented" role="tablist" aria-label="通用设置分类">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'general'}
          className={tab === 'general' ? 'is-active' : undefined}
          onClick={() => setTab('general')}
        >
          通用
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'personal'}
          className={tab === 'personal' ? 'is-active' : undefined}
          onClick={() => setTab('personal')}
        >
          个性化
        </button>
      </div>

      {tab === 'general' ? (
        <>
          <div className="settings-rows">
            <SettingRow
              title="界面动画"
              description="开启界面过渡动画"
              control={
                <Toggle checked={animationEnabled} label="界面动画" onChange={handleAnimation} />
              }
            />
            <SettingRow
              title="命令白名单"
              description="允许自动运行的命令"
              control={
                <Toggle checked={false} label="命令白名单" disabled onChange={() => undefined} />
              }
            />
          </div>

          <section className="settings-permission-section">
            <h2>权限模式</h2>
            <div className="settings-permission-grid" role="radiogroup" aria-label="默认权限模式">
              {PERMISSION_OPTIONS.map(({ value, label, desc }) => {
                const active = permission === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={clsx('settings-permission-option', active && 'is-active')}
                    onClick={() => handlePermission(value)}
                  >
                    <span>{label}</span>
                    <small>{desc}</small>
                    {active ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <DaemonCard />
        </>
      ) : (
        <PersonalizationPanel />
      )}
    </div>
  );
}

function PersonalizationPanel() {
  const [name, setName] = useState(() => readUserName());
  const [saved, setSaved] = useState(false);

  const commit = (value: string) => {
    const next = value.trim().slice(0, USER_NAME_MAX_LENGTH);
    writeUserName(next);
    // Let an already-mounted welcome screen pick the new name up immediately.
    window.dispatchEvent(new CustomEvent('shell-user-name-changed'));
    setSaved(true);
  };

  return (
    <div className="settings-rows">
      <SettingRow
        title="你的名字"
        description="用于新对话页的问候语，例如「晚上好，Kevin」"
        control={
          <input
            data-testid="settings-user-name"
            className="st-field-input"
            style={{ width: 180 }}
            value={name}
            maxLength={USER_NAME_MAX_LENGTH}
            placeholder="留空则不显示名字"
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(e.currentTarget.value);
            }}
          />
        }
      />
      <p className="settings-note">
        {saved ? '已保存。' : '失焦或按回车保存，仅存在本机。'}
      </p>
    </div>
  );
}

function ComputerUsePluginSection() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    const runtime = window.syncThink?.runtime;
    if (!runtime) {
      setError('Runtime 连接不可用，无法读取插件状态。');
      setLoading(false);
      return () => {
        disposed = true;
      };
    }
    void runtime
      .getSettings({ keys: [COMPUTER_USE_PLUGIN_SETTING_KEY] })
      .then((response) => {
        if (disposed) return;
        setEnabled(
          normalizeComputerUsePluginSetting(
            response.settings[COMPUTER_USE_PLUGIN_SETTING_KEY],
          ).enabled,
        );
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        setError(
          reason instanceof Error
            ? reason.message
            : '无法读取 Computer Use 插件状态。',
        );
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const handleEnabledChange = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    setError(undefined);
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime) throw new Error('Runtime 连接不可用。');
      await runtime.setSetting({
        key: COMPUTER_USE_PLUGIN_SETTING_KEY,
        value: { enabled: next },
      });
    } catch (reason) {
      setEnabled(previous);
      setError(
        reason instanceof Error
          ? reason.message
          : '保存 Computer Use 插件状态失败。',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-rows">
        <SettingRow
          title="Computer Use"
          description="使用 Windows UI Automation 检查并操作桌面应用。插件默认关闭。"
          control={
            <Toggle
              checked={enabled}
              disabled={loading || saving}
              label="启用 Computer Use 插件"
              onChange={(next) => void handleEnabledChange(next)}
            />
          }
        />
      </div>
      <p className="settings-note">
        {loading
          ? '正在读取插件状态…'
          : enabled
            ? '已启用：新的对话轮次可以使用桌面工具。'
            : '已停用：Runtime 不会暴露桌面工具，也不会启动 Desktop Host。'}
      </p>
      <p className="settings-note">
        插件开关决定是否具有桌面能力；权限模式决定启用后的动作是否需要批准。「完全访问」不会自动启用插件。
      </p>
      {error ? (
        <p className="settings-note" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Copy-to-clipboard row used for the gateway base URLs and external token. */
function CopyableValue({
  label,
  value,
  masked,
}: {
  label: string;
  value: string;
  masked?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const shown = masked && !revealed ? `${value.slice(0, 9)}••••••••••` : value;

  return (
    <div className="settings-row">
      <div>
        <p>{label}</p>
        <span className="settings-gateway-value">{shown}</span>
      </div>
      <div className="settings-row__control settings-gateway-actions">
        {masked ? (
          <button
            type="button"
            className="settings-gateway-button"
            onClick={() => setRevealed((prev) => !prev)}
          >
            {revealed ? '隐藏' : '显示'}
          </button>
        ) : null}
        <button
          type="button"
          className="settings-gateway-button"
          aria-label={`复制${label}`}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(value)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          <Copy size={13} aria-hidden="true" />
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * AI 模型网关 — a pure protocol-format converter on the connection page.
 *
 * Per-run traffic is routed by ticket (issued by the runtime when a run starts),
 * so this card never has to pick a provider: whatever the user selected in the
 * conversation input wins. The read-only upstream line mirrors the most recent
 * run the gateway actually routed. External terminal clients (no run context)
 * resolve model names through the catalog; no default-provider setting exists.
 */
function ConnectionSection() {
  const [setting, setSetting] = useState<OpenGatewaySetting>({ enabled: false, port: 0 });
  const [portDraft, setPortDraft] = useState('');
  const [status, setStatus] = useState<OpenGatewayStatusResponse>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const disposedRef = useRef(false);

  // The runtime rebinds the listener *after* answering settings.set, so the
  // bound state can only be learned by re-reading gateway.status.
  const refreshStatus = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getGatewayStatus) return;
    try {
      const next = await runtime.getGatewayStatus();
      if (!disposedRef.current) setStatus(next);
    } catch {
      // Status is advisory; a failed poll must not clobber the form.
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    const runtime = window.syncThink?.runtime;
    if (!runtime) {
      setError('Runtime 连接不可用，无法读取网关配置。');
      setLoading(false);
      return () => {
        disposedRef.current = true;
      };
    }
    void (async () => {
      try {
        const response = await runtime.getSettings({ keys: [OPEN_GATEWAY_SETTING_KEY] });
        if (disposedRef.current) return;
        const next = normalizeOpenGatewaySetting(response.settings[OPEN_GATEWAY_SETTING_KEY]);
        setSetting(next);
        setPortDraft(next.port === 0 ? '' : String(next.port));
        setError(undefined);
      } catch (reason) {
        if (!disposedRef.current) {
          setError(reason instanceof Error ? reason.message : '无法读取网关配置。');
        }
      } finally {
        if (!disposedRef.current) setLoading(false);
      }
      await refreshStatus();
    })();
    return () => {
      disposedRef.current = true;
    };
  }, [refreshStatus]);

  const persist = async (next: OpenGatewaySetting) => {
    const previous = setting;
    setSetting(next);
    setSaving(true);
    setError(undefined);
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime) throw new Error('Runtime 连接不可用。');
      await runtime.setSetting({ key: OPEN_GATEWAY_SETTING_KEY, value: next });
      await refreshStatus();
    } catch (reason) {
      setSetting(previous);
      setPortDraft(previous.port === 0 ? '' : String(previous.port));
      setError(reason instanceof Error ? reason.message : '保存网关配置失败。');
    } finally {
      if (!disposedRef.current) setSaving(false);
    }
  };

  const commitPort = (raw: string) => {
    const trimmed = raw.trim();
    // Empty input = OS auto-assign (port 0). The normalizer snaps out-of-range
    // values to 0, so validate here rather than relying on the round-trip.
    if (trimmed === '') {
      setError(undefined);
      if (setting.port === 0) return;
      void persist({ ...setting, port: 0 });
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      setPortDraft(setting.port === 0 ? '' : String(setting.port));
      setError('端口需为 1024-65535 之间的整数，或留空自动分配。');
      return;
    }
    setError(undefined);
    if (parsed === setting.port) return;
    void persist({ ...setting, port: parsed });
  };

  const statusText = (() => {
    if (loading) return '正在读取网关状态…';
    if (!setting.enabled) return '已停用：内核直连所选供应商，不经过本机转换。';
    if (status?.running) return `运行中：监听 127.0.0.1:${status.port}。`;
    if (status?.failureDetail) return status.failureDetail;
    if (status?.failure === 'bind-failed') return '网关启动失败，请查看 Runtime 日志。';
    return '正在启动网关…';
  })();

  const protocolLabel = (protocol: OpenGatewayUpstreamProtocol | undefined) =>
    protocol === 'anthropic-messages' ? 'Anthropic 格式' : 'OpenAI 格式';

  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-gateway-card">
        <div className="settings-gateway-card__head">
          <div className="settings-gateway-card__identity">
            <span className="settings-gateway-card__icon" aria-hidden="true">
              <Network size={18} />
            </span>
            <div>
              <h2 className="settings-gateway-card__title">AI 模型网关</h2>
              <p className="settings-gateway-card__subtitle">支持 OpenAI / Anthropic 双格式调用</p>
            </div>
          </div>
          <div className="settings-gateway-card__meta">
            {status?.running ? (
              <span
                className="settings-gateway-card__port"
                data-testid="settings-gateway-running-port"
              >
                {status.port}
              </span>
            ) : null}
            <Toggle
              checked={setting.enabled}
              disabled={loading || saving}
              label="启用网关"
              onChange={(next) => void persist({ ...setting, enabled: next })}
            />
          </div>
        </div>

        <div className="settings-gateway-card__body">
          <div className="settings-row">
            <div>
              <p>监听端口</p>
              <span>仅绑定 127.0.0.1，留空自动分配端口。</span>
            </div>
            <div className="settings-row__control">
              <input
                data-testid="settings-gateway-port"
                className="st-field-input"
                style={{ width: 120 }}
                inputMode="numeric"
                placeholder="自动分配"
                aria-label="网关监听端口"
                value={portDraft}
                disabled={loading || saving}
                onChange={(event) => setPortDraft(event.target.value)}
                onBlur={(event) => commitPort(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitPort(event.currentTarget.value);
                }}
              />
            </div>
          </div>

          {status?.running ? (
            <div className="settings-gateway-card__routes">
              <p className="settings-gateway-card__routes-title">可用接口</p>
              <div
                className="settings-gateway-card__route"
                data-testid="settings-gateway-route-openai"
              >
                <code>POST /v1/chat/completions</code>
                <span>OpenAI 格式</span>
              </div>
              <div
                className="settings-gateway-card__route"
                data-testid="settings-gateway-route-anthropic"
              >
                <code>POST /v1/messages</code>
                <span>Anthropic 格式</span>
              </div>
              <div
                className="settings-gateway-card__route"
                data-testid="settings-gateway-route-models"
              >
                <code>GET /v1/models</code>
                <span>模型列表</span>
              </div>
              <div className="settings-gateway-card__copy">
                {status.anthropicBaseUrl ? (
                  <CopyableValue
                    label="Anthropic 入口 (ANTHROPIC_BASE_URL)"
                    value={status.anthropicBaseUrl}
                  />
                ) : null}
                {status.openaiBaseUrl ? (
                  <CopyableValue
                    label="OpenAI 入口 (OPENAI_BASE_URL)"
                    value={status.openaiBaseUrl}
                  />
                ) : null}
                {status.modelsBaseUrl ? (
                  <CopyableValue label="模型列表 (GET /v1/models)" value={status.modelsBaseUrl} />
                ) : null}
              </div>
            </div>
          ) : null}

          <p
            className="settings-gateway-card__upstream"
            data-testid="settings-gateway-upstream"
          >
            {status?.lastUpstream
              ? `上游：${status.lastUpstream.providerName}（${protocolLabel(
                  status.lastUpstream.protocol,
                )}），网关自动转换协议`
              : '上游：跟随对话所选供应商与模型，网关自动转换协议'}
          </p>
        </div>
      </div>

      <p
        className={clsx(
          'settings-note',
          status?.failure && setting.enabled && 'settings-gateway-note--alert',
        )}
        data-testid="settings-gateway-status"
        aria-live="polite"
      >
        {statusText}
      </p>
      <p className="settings-note">
        内部对话按「运行票据」路由：启动时锁定对话输入框里选择的供应商与模型，多个供应商存在同名模型也不会串。
      </p>
      {error ? (
        <p className="settings-note" role="alert">
          {error}
        </p>
      ) : null}

      <GatewayAuditLogs />
    </div>
  );
}

const GATEWAY_PAGE_SIZE = 50;

const GATEWAY_DIALECT_LABEL: Record<OpenGatewayUpstreamProtocol, string> = {
  'anthropic-messages': 'Anthropic',
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
};

const GATEWAY_KERNEL_LABEL: Record<string, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  native: 'Sync-Think',
  external: '外部 CLI',
};

/** Try to pretty-print JSON; fall back to the raw text (truncated bodies). */
function prettyJsonText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

function formatLogTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * 网关转换审计日志（AI 模型网关卡片下方）。
 *
 * 每次代理/转换请求都会记录：原始格式（inbound body）、转换后格式（upstream
 * body）与驱动该请求的内核（外部 CLI 记为 external）。内存环形缓冲，分页查看，
 * 可筛选（类型 / 状态 / 内核）、清空与导出 JSON。
 */
function GatewayAuditLogs() {
  const [entries, setEntries] = useState<GatewayRequestLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<GatewayLogsFilter>({});
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getGatewayLogs) return;
    try {
      const next = await runtime.getGatewayLogs({
        offset: page * GATEWAY_PAGE_SIZE,
        limit: GATEWAY_PAGE_SIZE,
        filter,
      });
      setEntries(next.entries);
      setTotal(next.total);
      setHasMore(next.hasMore);
    } catch {
      // Advisory panel; a failed poll keeps the last rendered page.
    }
  }, [page, filter]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const patchFilter = (patch: GatewayLogsFilter) => {
    setFilter((previous) => ({ ...previous, ...patch }));
    setPage(0);
    setExpandedId(undefined);
  };

  const clearAll = async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.clearGatewayLogs || clearing) return;
    setClearing(true);
    try {
      await runtime.clearGatewayLogs();
      setPage(0);
      setExpandedId(undefined);
      await refresh();
    } finally {
      setClearing(false);
    }
  };

  const exportJson = () => {
    if (entries.length === 0) return;
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gateway-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const kernelOptions = [
    { value: undefined, label: '全部内核' },
    { value: 'codex', label: 'Codex' },
    { value: 'claude-code', label: 'Claude Code' },
    { value: 'native', label: 'Sync-Think' },
    { value: 'external', label: '外部 CLI' },
  ] as const;

  return (
    <div className="settings-gateway-logs" data-testid="settings-gateway-logs">
      <div className="settings-gateway-logs__head">
        <div className="settings-gateway-logs__title">
          <h3>转换日志</h3>
          <span className="settings-gateway-logs__count">
            {total > 0 ? `${total} 条` : '暂无请求'}
          </span>
        </div>
        <div className="settings-gateway-logs__actions">
          <button
            type="button"
            className="settings-gateway-logs__action"
            onClick={() => void refresh()}
            title="刷新"
          >
            <RefreshCw size={13} />
            刷新
          </button>
          <button
            type="button"
            className="settings-gateway-logs__action"
            onClick={exportJson}
            disabled={entries.length === 0}
            title="导出当前页为 JSON 文件"
          >
            <Download size={13} />
            导出 JSON
          </button>
          <button
            type="button"
            className="settings-gateway-logs__action settings-gateway-logs__action--danger"
            onClick={() => void clearAll()}
            disabled={clearing || total === 0}
            title="清空全部日志"
          >
            <Trash2 size={13} />
            清空
          </button>
        </div>
      </div>

      <div className="settings-gateway-logs__filters">
        <div className="settings-gateway-logs__filter-group">
          <span className="settings-gateway-logs__filter-label">类型</span>
          <button
            type="button"
            className={clsx('settings-gateway-logs__chip', filter.converted === undefined && 'is-active')}
            onClick={() => patchFilter({ converted: undefined })}
          >
            全部
          </button>
          <button
            type="button"
            className={clsx('settings-gateway-logs__chip', filter.converted === true && 'is-active')}
            onClick={() => patchFilter({ converted: true })}
          >
            转换
          </button>
          <button
            type="button"
            className={clsx('settings-gateway-logs__chip', filter.converted === false && 'is-active')}
            onClick={() => patchFilter({ converted: false })}
          >
            直通
          </button>
        </div>
        <div className="settings-gateway-logs__filter-group">
          <span className="settings-gateway-logs__filter-label">状态</span>
          <button
            type="button"
            className={clsx('settings-gateway-logs__chip', filter.status === undefined && 'is-active')}
            onClick={() => patchFilter({ status: undefined })}
          >
            全部
          </button>
          <button
            type="button"
            className={clsx('settings-gateway-logs__chip', filter.status === 'success' && 'is-active')}
            onClick={() => patchFilter({ status: 'success' })}
          >
            成功
          </button>
          <button
            type="button"
            className={clsx('settings-gateway-logs__chip', filter.status === 'error' && 'is-active')}
            onClick={() => patchFilter({ status: 'error' })}
          >
            失败
          </button>
        </div>
        <div className="settings-gateway-logs__filter-group">
          <span className="settings-gateway-logs__filter-label">内核</span>
          {kernelOptions.map((option) => (
            <button
              key={option.value ?? 'all'}
              type="button"
              className={clsx(
                'settings-gateway-logs__chip',
                filter.kernelId === option.value && 'is-active',
              )}
              onClick={() => patchFilter({ kernelId: option.value })}
              title={option.label}
            >
              {option.value && option.value !== 'external' ? (
                <BrandLogoMark logo={resolveKernelBrandLogo(option.value)!} size={12} />
              ) : option.value === 'external' ? (
                <TerminalSquare size={11} />
              ) : null}
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="settings-gateway-logs__empty">
          {total === 0 ? '还没有网关请求记录。' : '当前筛选条件下没有匹配的请求。'}
        </div>
      ) : (
        <div className="settings-gateway-logs__list">
          {entries.map((entry) => {
            const kernelLogo =
              entry.kernelId && entry.kernelId !== 'external'
                ? resolveKernelBrandLogo(entry.kernelId)
                : undefined;
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id}>
                <button
                  type="button"
                  className={clsx(
                    'settings-gateway-logs__row',
                    entry.status === 'error' && 'is-error',
                  )}
                  onClick={() => setExpandedId(expanded ? undefined : entry.id)}
                  data-testid="gateway-log-row"
                >
                  <span className="settings-gateway-logs__time">{formatLogTime(entry.occurredAt)}</span>
                  <span
                    className="settings-gateway-logs__kernel"
                    title={GATEWAY_KERNEL_LABEL[entry.kernelId ?? 'external'] ?? entry.kernelId}
                  >
                    {kernelLogo ? (
                      <BrandLogoMark logo={kernelLogo} size={14} />
                    ) : (
                      <TerminalSquare size={13} />
                    )}
                  </span>
                  <span className="settings-gateway-logs__dialect">
                    {GATEWAY_DIALECT_LABEL[entry.inboundDialect]}
                    <ArrowRight size={10} />
                    {GATEWAY_DIALECT_LABEL[entry.upstreamProtocol]}
                  </span>
                  <code className="settings-gateway-logs__model">{entry.model}</code>
                  {entry.status === 'success' ? (
                    <span className="settings-gateway-logs__status is-ok" title="成功">
                      <Check size={13} />
                    </span>
                  ) : (
                    <span
                      className="settings-gateway-logs__status is-err"
                      title={entry.errorMessage ?? '失败'}
                    >
                      <AlertCircle size={13} />
                    </span>
                  )}
                  <span className="settings-gateway-logs__latency">
                    {entry.latencyMs !== undefined ? `${entry.latencyMs}ms` : '—'}
                  </span>
                </button>
                {expanded ? (
                  <div className="settings-gateway-logs__detail">
                    <div className="settings-gateway-logs__detail-meta">
                      <span>
                        内核：{GATEWAY_KERNEL_LABEL[entry.kernelId ?? 'external'] ?? entry.kernelId ?? '外部'}
                      </span>
                      {entry.runId ? <span>运行：{entry.runId}</span> : null}
                      <span>耗时：{entry.latencyMs !== undefined ? `${entry.latencyMs}ms` : '—'}</span>
                      {entry.truncated ? <span>正文已截断</span> : null}
                    </div>
                    {entry.errorMessage ? (
                      <p className="settings-gateway-logs__detail-error">{entry.errorMessage}</p>
                    ) : null}
                    <div className="settings-gateway-logs__detail-bodies">
                      <div className="settings-gateway-logs__detail-body">
                        <p>
                          原始格式（{GATEWAY_DIALECT_LABEL[entry.inboundDialect]}）
                        </p>
                        <pre>{prettyJsonText(entry.rawRequest)}</pre>
                      </div>
                      <div className="settings-gateway-logs__detail-body">
                        <p>
                          转换后格式（{GATEWAY_DIALECT_LABEL[entry.upstreamProtocol]}）
                        </p>
                        <pre>{prettyJsonText(entry.convertedRequest)}</pre>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="settings-gateway-logs__pager">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => {
            setPage((current) => Math.max(current - 1, 0));
            setExpandedId(undefined);
          }}
        >
          上一页
        </button>
        <span>
          第 {page + 1} 页 · 共 {total} 条
        </span>
        <button
          type="button"
          disabled={!hasMore}
          onClick={() => {
            setPage((current) => current + 1);
            setExpandedId(undefined);
          }}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

type DiagnosticsExportState =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | {
      kind: 'saved';
      path: string;
      diagnosticCount: number;
      crashReportCount: number;
    }
  | {
      kind: 'cancelled';
      diagnosticCount: number;
      crashReportCount: number;
    }
  | { kind: 'error'; message: string };

export function DataDiagnosticsSection() {
  const [exportState, setExportState] = useState<DiagnosticsExportState>({ kind: 'idle' });

  const handleExport = async () => {
    if (exportState.kind === 'exporting') return;
    setExportState({ kind: 'exporting' });
    try {
      const runtime = window.syncThink?.runtime;
      if (!runtime?.exportDiagnostics) throw new Error('诊断导出服务尚未就绪。');
      const result = await runtime.exportDiagnostics({});
      if (result.status === 'saved') {
        setExportState({
          kind: 'saved',
          path: result.path,
          diagnosticCount: result.diagnosticCount,
          crashReportCount: result.crashReportCount,
        });
        return;
      }
      setExportState({
        kind: 'cancelled',
        diagnosticCount: result.diagnosticCount,
        crashReportCount: result.crashReportCount,
      });
    } catch (reason) {
      setExportState({
        kind: 'error',
        message: reason instanceof Error ? reason.message : '诊断导出失败。',
      });
    }
  };

  const status = (() => {
    switch (exportState.kind) {
      case 'exporting':
        return { role: 'status' as const, text: '正在收集并脱敏诊断信息…' };
      case 'saved':
        return {
          role: 'status' as const,
          text: `已保存 ${exportState.diagnosticCount} 条诊断与 ${exportState.crashReportCount} 条崩溃记录：${exportState.path}`,
        };
      case 'cancelled':
        return {
          role: 'status' as const,
          text: `已取消保存。已准备 ${exportState.diagnosticCount} 条诊断与 ${exportState.crashReportCount} 条崩溃记录。`,
        };
      case 'error':
        return { role: 'alert' as const, text: exportState.message };
      default:
        return null;
    }
  })();

  return (
    <div className="settings-scroll settings-standard-pane settings-diagnostics-export">
      <section className="settings-diagnostics-export__hero" aria-labelledby="diagnostics-title">
        <div className="settings-diagnostics-export__eyebrow">LOCAL SUPPORT BUNDLE</div>
        <div className="settings-diagnostics-export__heading">
          <div>
            <h2 id="diagnostics-title">导出脱敏诊断</h2>
            <p>生成一份可人工检查和共享的本地 JSON，用于定位 Runtime、更新器与桌面进程问题。</p>
          </div>
          <button
            type="button"
            className="settings-diagnostics-export__button"
            disabled={exportState.kind === 'exporting'}
            aria-describedby="diagnostics-privacy diagnostics-status"
            onClick={() => void handleExport()}
          >
            <Download size={15} aria-hidden="true" />
            {exportState.kind === 'exporting' ? '正在导出' : '导出诊断 JSON'}
          </button>
        </div>
      </section>

      <div className="settings-diagnostics-export__ledger" aria-label="诊断导出隐私范围">
        <div>
          <span>INCLUDED</span>
          <strong>运行状态、更新器证据、脱敏事件</strong>
          <p>仅保留故障定位所需的结构化元数据。</p>
        </div>
        <div>
          <span>EXCLUDED</span>
          <strong>API Key、原始提示词、原始消息内容</strong>
          <p>敏感字段与用户目录会在写盘前清理。</p>
        </div>
        <div>
          <span>RETENTION</span>
          <strong>最多 20 条 / 14 天</strong>
          <p>崩溃记录只保存在本机，并按期限自动清理。</p>
        </div>
      </div>

      <p id="diagnostics-privacy" className="settings-note">
        诊断包不会自动上传。保存前可选择路径，保存后可用文本编辑器检查全部内容。
      </p>
      <div
        id="diagnostics-status"
        className={clsx(
          'settings-diagnostics-export__status',
          exportState.kind === 'error' && 'is-error',
          exportState.kind === 'saved' && 'is-saved',
        )}
        role={status?.role}
        aria-live="polite"
      >
        {status?.text ?? '尚未创建诊断包。'}
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-about-head">
        <img
          src={syncThinkLogo}
          alt="Sync-Think"
          draggable={false}
          className="sync-think-logo settings-app-mark object-contain"
        />
        <div>
          <h2>Sync-Think</h2>
          <p>AI 工作助手 · 多智能体编排工作台</p>
          <span>桌面端发布与更新控制面</span>
        </div>
      </div>
      <DesktopUpdatePanel />
      <div className="settings-rows">
        <SettingRow title="运行环境" description="Electron + Node.js" />
        <SettingRow title="界面框架" description="React + Tailwind v4" />
        <SettingRow title="数据库" description="SQLite (better-sqlite3)" />
      </div>
    </div>
  );
}

function ComingSoonSection({ label }: { label: string }) {
  return (
    <div className="settings-scroll settings-standard-pane">
      <div className="settings-empty-panel">
        <p>“{label}”能力尚未接入。</p>
        <span>入口按照 NewMax 信息架构保留，接入时不会再调整设置布局。</span>
      </div>
    </div>
  );
}

function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control?: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <p>{title}</p>
        {description ? <span>{description}</span> : null}
      </div>
      {control ? <div className="settings-row__control">{control}</div> : null}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('settings-toggle', checked && 'is-checked')}
    >
      <span />
    </button>
  );
}
