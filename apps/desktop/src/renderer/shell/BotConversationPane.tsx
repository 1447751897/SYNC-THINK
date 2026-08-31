import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  MessageCircle,
  QrCode,
  X,
} from 'lucide-react';
import telegramIcon from './assets/bot-channels/telegram.png';
import feishuIcon from './assets/bot-channels/feishu.png';
import wecomIcon from './assets/bot-channels/wecom.png';
import wechatIcon from './assets/bot-channels/wechat.png';
import discordIcon from './assets/bot-channels/discord.png';
import dingtalkIcon from './assets/bot-channels/dingtalk.png';
import qqIcon from './assets/bot-channels/qq.png';
import { SlidingTabs } from './SlidingTabs.js';
import type {
  BotChannelConfigSummary,
  BotChannelPlatform,
  SaveBotChannelConfigPayload,
} from '@sync-think/protocol';

const CHANNELS: ReadonlyArray<{
  id: BotChannelPlatform;
  label: string;
  badge: string;
  description: string;
  docs: string;
}> = [
  {
    id: 'telegram',
    label: 'Telegram',
    badge: 'TG',
    description: '通过 Telegram Bot API 接收消息，并将回复送回原会话。',
    docs: 'https://core.telegram.org/bots/tutorial',
  },
  {
    id: 'feishu',
    label: '飞书',
    badge: '飞',
    description: '使用飞书或 Lark 长连接订阅消息事件，无需配置公网回调地址。',
    docs: 'https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-overview',
  },
  {
    id: 'wecom',
    label: '企业微信',
    badge: '企',
    description: '使用企业微信智能机器人 WebSocket 长连接收发消息。',
    docs: 'https://work.weixin.qq.com/nl/index/openclaw',
  },
  {
    id: 'wechat',
    label: '微信',
    badge: '微',
    description: '通过微信 iLink ClawBot 扫码连接，支持单聊消息与 24 小时回复窗口。',
    docs: 'https://docs.openclaw.ai/plugins/community',
  },
  {
    id: 'discord',
    label: 'Discord',
    badge: 'D',
    description: '连接 Discord Bot，响应服务器频道与私信中的文本消息。',
    docs: 'https://discord.com/developers/docs/intro',
  },
  {
    id: 'dingtalk',
    label: '钉钉',
    badge: '钉',
    description: '使用钉钉 Stream 模式建立长连接并回复机器人消息。',
    docs: 'https://open.dingtalk.com/document/tutorial/create-a-robot',
  },
  {
    id: 'qq',
    label: 'QQ',
    badge: 'Q',
    description: '连接 QQ 开放平台机器人，支持单聊、群聊和频道消息。',
    docs: 'https://q.qq.com/qqbot/openclaw/login.html',
  },
];

interface Draft {
  token: string;
  proxyUrl: string;
  appId: string;
  appSecret: string;
  domain: 'feishu' | 'lark';
  renderMode: 'card' | 'text';
  botId: string;
  secret: string;
  botToken: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

const EMPTY_DRAFT: Draft = {
  token: '',
  proxyUrl: '',
  appId: '',
  appSecret: '',
  domain: 'feishu',
  renderMode: 'card',
  botId: '',
  secret: '',
  botToken: '',
  baseUrl: 'https://ilinkai.weixin.qq.com',
  clientId: '',
  clientSecret: '',
};

export function BotConversationPane() {
  const [selected, setSelected] = useState<BotChannelPlatform>('telegram');
  const [configs, setConfigs] = useState<
    Partial<Record<BotChannelPlatform, BotChannelConfigSummary>>
  >({});
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [shownSecrets, setShownSecrets] = useState<Set<string>>(() => new Set());
  const [qr, setQr] = useState<{ value: string; image: string }>();
  const qrPollRef = useRef<ReturnType<typeof setInterval>>();
  const qrTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const qrSessionRef = useRef(0);
  const configPanelRef = useRef<HTMLDivElement>(null);

  const clearWechatQrTimers = useCallback(() => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    if (qrTimeoutRef.current) clearTimeout(qrTimeoutRef.current);
    qrPollRef.current = undefined;
    qrTimeoutRef.current = undefined;
  }, []);

  const cancelWechatQr = useCallback(() => {
    qrSessionRef.current += 1;
    clearWechatQrTimers();
    setQr(undefined);
    setBusy(false);
  }, [clearWechatQrTimers]);

  const refresh = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getBotChannelConfig) throw new Error('Runtime 连接不可用。');
    const entries = await Promise.all(
      CHANNELS.map(
        async ({ id }) => [id, await runtime.getBotChannelConfig({ platform: id })] as const,
      ),
    );
    setConfigs(Object.fromEntries(entries));
    return Object.fromEntries(entries) as Record<BotChannelPlatform, BotChannelConfigSummary>;
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await refresh();
        if (active) setDraft(draftFromConfig(next[selected]));
      } catch (reason) {
        if (active) setError(errorText(reason, '读取机器人设置失败。'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void refresh().catch(() => undefined), 5_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh, selected]);

  useEffect(
    () => () => {
      qrSessionRef.current += 1;
      clearWechatQrTimers();
    },
    [clearWechatQrTimers],
  );

  const channel = useMemo(() => CHANNELS.find((item) => item.id === selected)!, [selected]);
  const config = configs[selected] ?? emptySummary(selected);

  const selectChannel = (platform: BotChannelPlatform) => {
    if (selected === 'wechat' && platform !== 'wechat') cancelWechatQr();
    setSelected(platform);
    setDraft(draftFromConfig(configs[platform] ?? emptySummary(platform)));
    setNotice(undefined);
    setError(undefined);
    setQr(undefined);
  };

  const save = async (enabled: boolean, testConnection: boolean) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.saveBotChannelConfig) {
      setError('Runtime 连接不可用。');
      return;
    }
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const payload = buildPayload(selected, draft, enabled, testConnection);
      const response = await runtime.saveBotChannelConfig(payload);
      setConfigs((current) => ({ ...current, [selected]: response.config }));
      setDraft((current) => clearSecretFields(current));
      setNotice(
        testConnection
          ? `${channel.label} 连接测试通过，设置已保存。`
          : enabled
            ? `${channel.label} 已启用。`
            : `${channel.label} 已停用。`,
      );
    } catch (reason) {
      const message = errorText(reason, `${channel.label} 设置保存失败。`);
      setError(message);
      if (/请填写|凭据|token|secret|app id|bot id|client id/iu.test(message)) {
        queueMicrotask(() => {
          configPanelRef.current
            ?.querySelector<HTMLInputElement>('.settings-bot-form input')
            ?.focus();
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const requestWechatQr = async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.requestWechatBotQr || !runtime.checkWechatBotQr) {
      setError('Runtime 微信扫码接口尚未就绪。');
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      cancelWechatQr();
      setBusy(true);
      const qrSession = qrSessionRef.current;
      const response = await runtime.requestWechatBotQr({ baseUrl: draft.baseUrl.trim() });
      if (qrSession !== qrSessionRef.current) return;
      setQr({ value: response.qrcode, image: response.qrcodeImage });
      qrPollRef.current = setInterval(async () => {
        if (qrSession !== qrSessionRef.current) return;
        try {
          const status = await runtime.checkWechatBotQr({
            qrcode: response.qrcode,
            baseUrl: draft.baseUrl.trim(),
          });
          if (qrSession !== qrSessionRef.current) return;
          if (status.status === 'confirmed' && status.config) {
            clearWechatQrTimers();
            qrSessionRef.current += 1;
            setQr(undefined);
            setConfigs((current) => ({ ...current, wechat: status.config! }));
            setDraft(draftFromConfig(status.config));
            setNotice('微信已扫码连接并启用。');
            setBusy(false);
          } else if (status.status === 'expired' || status.status === 'cancelled') {
            clearWechatQrTimers();
            qrSessionRef.current += 1;
            setQr(undefined);
            setError('二维码已失效，请重新获取。');
            setBusy(false);
          }
        } catch (reason) {
          if (qrSession !== qrSessionRef.current) return;
          clearWechatQrTimers();
          qrSessionRef.current += 1;
          setQr(undefined);
          setError(errorText(reason, '读取微信扫码状态失败。'));
          setBusy(false);
        }
      }, 1_500);
      qrTimeoutRef.current = setTimeout(() => {
        if (qrSession === qrSessionRef.current) cancelWechatQr();
      }, 5 * 60_000);
    } catch (reason) {
      setError(errorText(reason, '获取微信二维码失败。'));
      setBusy(false);
    }
  };

  return (
    <section className="settings-bot-pane" aria-label="机器人对话设置">
      <aside className="settings-bot-channels" aria-label="机器人通道">
        {CHANNELS.map((item) => {
          const itemConfig = configs[item.id];
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              className={item.id === selected ? 'is-active' : undefined}
              aria-pressed={item.id === selected}
              onClick={() => selectChannel(item.id)}
            >
              <span className="settings-bot-channel-icon">
                <PlatformIcon platform={item.id} badge={item.badge} />
                {itemConfig?.enabled || itemConfig?.state !== 'disconnected' ? (
                  <span
                    className={`settings-bot-channel-state is-${itemConfig?.state ?? 'disconnected'}`}
                  />
                ) : null}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </aside>

      <div className="settings-bot-config" ref={configPanelRef}>
        <div className="settings-bot-config__hero">
          <div>
            <span className="settings-bot-hero-icon">
              <PlatformIcon platform={selected} badge={channel.badge} />
            </span>
            <div>
              <h2>{channel.label}</h2>
              <p className={`is-${config.state}`}>
                <span aria-hidden="true" />
                {loading ? '正在读取设置…' : stateLabel(config.state)}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.enabled}
            aria-label={`启用 ${channel.label} 机器人`}
            className="settings-bot-switch"
            disabled={loading || busy}
            onClick={() => void save(!config.enabled, false)}
          >
            <span />
          </button>
        </div>

        <p className="settings-bot-description">{channel.description}</p>
        <button
          type="button"
          className="settings-bot-docs"
          onClick={() => void window.syncThink?.runtime?.openExternalUrl?.(channel.docs)}
        >
          查看配置文档
          <ArrowRight size={13} aria-hidden="true" />
        </button>

        <div className="settings-bot-form">
          <PlatformFields
            platform={selected}
            config={config}
            draft={draft}
            shownSecrets={shownSecrets}
            update={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
            toggleSecret={(key) =>
              setShownSecrets((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          />
        </div>

        {selected === 'wechat' ? (
          <div className="settings-bot-qr-wrap">
            <button
              type="button"
              className="settings-bot-test"
              disabled={busy}
              onClick={() => void requestWechatQr()}
            >
              {busy ? <LoaderCircle size={14} className="is-spinning" /> : <QrCode size={14} />}
              {qr ? '等待微信扫码' : '扫码连接微信'}
            </button>
            {qr ? (
              <div className="settings-bot-qr-popover" role="dialog" aria-label="微信扫码登录">
                <button type="button" aria-label="取消微信扫码" onClick={cancelWechatQr}>
                  <X size={14} aria-hidden="true" />
                </button>
                <strong>使用微信扫描二维码</strong>
                <img src={qr.image} alt="微信登录二维码" />
                <small>请在 5 分钟内完成确认</small>
              </div>
            ) : null}
          </div>
        ) : null}

        {notice ? (
          <p className="settings-connectors-notice" role="status">
            <Check size={13} aria-hidden="true" />
            {notice}
          </p>
        ) : null}
        {error || config.lastError ? (
          <p className="settings-connectors-notice is-error" role="alert">
            <AlertCircle size={13} aria-hidden="true" />
            {error ?? config.lastError}
          </p>
        ) : null}

        {selected !== 'wechat' ? (
          <button
            type="button"
            className="settings-bot-test"
            disabled={busy || loading}
            onClick={() => void save(config.enabled, true)}
          >
            {busy ? (
              <LoaderCircle size={14} className="is-spinning" />
            ) : (
              <MessageCircle size={14} />
            )}
            {busy ? '正在测试' : '测试并保存'}
          </button>
        ) : config.credentialsConfigured ? (
          <button
            type="button"
            className="settings-bot-test is-secondary"
            disabled={busy || loading}
            onClick={() => void save(config.enabled, true)}
          >
            <MessageCircle size={14} />
            测试当前连接
          </button>
        ) : null}
      </div>
    </section>
  );
}

function PlatformFields({
  platform,
  config,
  draft,
  shownSecrets,
  update,
  toggleSecret,
}: {
  platform: BotChannelPlatform;
  config: BotChannelConfigSummary;
  draft: Draft;
  shownSecrets: ReadonlySet<string>;
  update<K extends keyof Draft>(key: K, value: Draft[K]): void;
  toggleSecret(key: string): void;
}) {
  if (platform === 'telegram' || platform === 'discord') {
    return (
      <>
        <SecretField
          label="Bot Token"
          value={draft.token}
          configured={config.credentialsConfigured}
          shown={shownSecrets.has('token')}
          placeholder={platform === 'telegram' ? '123456:ABC-DEF…' : 'MTAx…'}
          onChange={(value) => update('token', value)}
          onToggle={() => toggleSecret('token')}
        />
        <TextField
          label="代理地址"
          value={draft.proxyUrl}
          placeholder="http://127.0.0.1:7890"
          hint="网络受限时填写 HTTP/HTTPS 代理；直连环境留空。"
          onChange={(value) => update('proxyUrl', value)}
        />
      </>
    );
  }
  if (platform === 'feishu') {
    return (
      <>
        <TextField
          label="App ID"
          value={draft.appId}
          placeholder="cli_xxxx"
          onChange={(value) => update('appId', value)}
        />
        <SecretField
          label="App Secret"
          value={draft.appSecret}
          configured={config.credentialsConfigured}
          shown={shownSecrets.has('appSecret')}
          placeholder="xxxx"
          onChange={(value) => update('appSecret', value)}
          onToggle={() => toggleSecret('appSecret')}
        />
        <SegmentedField
          label="服务域名"
          value={draft.domain}
          options={[
            ['feishu', '飞书'],
            ['lark', 'Lark'],
          ]}
          onChange={(value) => update('domain', value as Draft['domain'])}
        />
        <SegmentedField
          label="回复样式"
          value={draft.renderMode}
          options={[
            ['card', '卡片'],
            ['text', '纯文本'],
          ]}
          onChange={(value) => update('renderMode', value as Draft['renderMode'])}
        />
      </>
    );
  }
  if (platform === 'wecom') {
    return (
      <>
        <TextField
          label="Bot ID"
          value={draft.botId}
          placeholder="企业微信智能机器人 Bot ID"
          onChange={(value) => update('botId', value)}
        />
        <SecretField
          label="Secret"
          value={draft.secret}
          configured={config.credentialsConfigured}
          shown={shownSecrets.has('secret')}
          placeholder="xxxx"
          onChange={(value) => update('secret', value)}
          onToggle={() => toggleSecret('secret')}
        />
      </>
    );
  }
  if (platform === 'dingtalk') {
    return (
      <>
        <TextField
          label="Client ID (AppKey)"
          value={draft.clientId}
          placeholder="dingxxxxxxxx"
          onChange={(value) => update('clientId', value)}
        />
        <SecretField
          label="Client Secret (AppSecret)"
          value={draft.clientSecret}
          configured={config.credentialsConfigured}
          shown={shownSecrets.has('clientSecret')}
          placeholder="xxxx"
          onChange={(value) => update('clientSecret', value)}
          onToggle={() => toggleSecret('clientSecret')}
        />
      </>
    );
  }
  if (platform === 'qq') {
    return (
      <>
        <TextField
          label="AppID"
          value={draft.appId}
          placeholder="102xxxxxx"
          onChange={(value) => update('appId', value)}
        />
        <SecretField
          label="AppSecret"
          value={draft.appSecret}
          configured={config.credentialsConfigured}
          shown={shownSecrets.has('appSecret')}
          placeholder="xxxx"
          onChange={(value) => update('appSecret', value)}
          onToggle={() => toggleSecret('appSecret')}
        />
      </>
    );
  }
  return (
    <>
      <SecretField
        label="Bot Token"
        value={draft.botToken}
        configured={config.credentialsConfigured}
        shown={shownSecrets.has('botToken')}
        placeholder="扫码后自动安全保存，也可手动填写"
        onChange={(value) => update('botToken', value)}
        onToggle={() => toggleSecret('botToken')}
      />
      <TextField
        label="iLink 服务地址"
        value={draft.baseUrl}
        placeholder="https://ilinkai.weixin.qq.com"
        onChange={(value) => update('baseUrl', value)}
      />
    </>
  );
}

function TextField({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  onChange(value: string): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function SecretField({
  label,
  value,
  configured,
  shown,
  placeholder,
  onChange,
  onToggle,
}: {
  label: string;
  value: string;
  configured: boolean;
  shown: boolean;
  placeholder: string;
  onChange(value: string): void;
  onToggle(): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <div className="settings-bot-secret">
        <input
          type={shown ? 'text' : 'password'}
          aria-label={label}
          value={value}
          placeholder={configured ? '已安全保存，留空保持不变' : placeholder}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={shown ? `隐藏${label}` : `显示${label}`}
          onClick={onToggle}
        >
          {shown ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </label>
  );
}

function SegmentedField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange(value: string): void;
}) {
  return (
    <fieldset className="settings-bot-segments">
      <legend>{label}</legend>
      <SlidingTabs className="settings-bot-segments__track" aria-label={label}>
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={value === id}
            tabIndex={value === id ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                return;
              }
              event.preventDefault();
              const currentIndex = options.findIndex(([optionId]) => optionId === id);
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? options.length - 1
                    : (currentIndex + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                      options.length;
              const track = event.currentTarget.parentElement;
              onChange(options[nextIndex]![0]);
              window.requestAnimationFrame(() => {
                track?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
              });
            }}
          >
            {text}
          </button>
        ))}
      </SlidingTabs>
    </fieldset>
  );
}

function PlatformIcon({ platform }: { platform: BotChannelPlatform; badge: string }) {
  const icon = {
    telegram: telegramIcon,
    feishu: feishuIcon,
    wecom: wecomIcon,
    wechat: wechatIcon,
    discord: discordIcon,
    dingtalk: dingtalkIcon,
    qq: qqIcon,
  }[platform];
  return (
    <img
      className={`settings-bot-brand-icon is-${platform}`}
      src={icon}
      alt=""
      aria-hidden="true"
    />
  );
}

function buildPayload(
  platform: BotChannelPlatform,
  draft: Draft,
  enabled: boolean,
  testConnection: boolean,
): SaveBotChannelConfigPayload {
  const common = { platform, enabled, testConnection } as const;
  if (platform === 'telegram' || platform === 'discord')
    return {
      ...common,
      ...(draft.token.trim() ? { token: draft.token.trim() } : {}),
      proxyUrl: draft.proxyUrl.trim(),
    };
  if (platform === 'feishu')
    return {
      ...common,
      appId: draft.appId.trim(),
      ...(draft.appSecret.trim() ? { appSecret: draft.appSecret.trim() } : {}),
      domain: draft.domain,
      renderMode: draft.renderMode,
    };
  if (platform === 'wecom')
    return {
      ...common,
      botId: draft.botId.trim(),
      ...(draft.secret.trim() ? { secret: draft.secret.trim() } : {}),
    };
  if (platform === 'dingtalk')
    return {
      ...common,
      clientId: draft.clientId.trim(),
      ...(draft.clientSecret.trim() ? { clientSecret: draft.clientSecret.trim() } : {}),
    };
  if (platform === 'qq')
    return {
      ...common,
      appId: draft.appId.trim(),
      ...(draft.appSecret.trim() ? { appSecret: draft.appSecret.trim() } : {}),
    };
  return {
    ...common,
    ...(draft.botToken.trim() ? { botToken: draft.botToken.trim() } : {}),
    baseUrl: draft.baseUrl.trim(),
  };
}

function draftFromConfig(config: BotChannelConfigSummary): Draft {
  return {
    ...EMPTY_DRAFT,
    proxyUrl: config.proxyUrl ?? '',
    appId: config.appId ?? '',
    botId: config.botId ?? '',
    clientId: config.clientId ?? '',
    domain: config.domain ?? 'feishu',
    renderMode: config.renderMode ?? 'card',
    baseUrl: config.baseUrl ?? 'https://ilinkai.weixin.qq.com',
  };
}

function clearSecretFields(draft: Draft): Draft {
  return { ...draft, token: '', appSecret: '', secret: '', botToken: '', clientSecret: '' };
}

function emptySummary(platform: BotChannelPlatform): BotChannelConfigSummary {
  return {
    platform,
    enabled: false,
    credentialsConfigured: false,
    connected: false,
    state: 'disconnected',
  };
}

function stateLabel(state: BotChannelConfigSummary['state']): string {
  return { disconnected: '未连接', connecting: '连接中', connected: '已连接', error: '连接异常' }[
    state
  ];
}

function errorText(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? reason.message : String(reason ?? '');
  const detail = raw
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^RuntimeResponseError:\s*/i, '')
    .trim();
  return detail || fallback;
}
