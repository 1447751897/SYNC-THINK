import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Search,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  TestWebSearchProviderResponse,
  WebSearchProviderId,
  WebSearchProviderSummary,
} from '@sync-think/protocol';

export function WebSearchSettings() {
  const [providers, setProviders] = useState<WebSearchProviderSummary[]>([]);
  const [expandedId, setExpandedId] = useState<WebSearchProviderId>();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<WebSearchProviderId>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const api = window.syncThink?.runtime;
    if (!api?.listWebSearchProviders) {
      setError('Runtime 搜索服务接口未就绪。');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await api.listWebSearchProviders();
      setProviders(response.providers);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取搜索服务失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (provider: WebSearchProviderSummary) => {
    if (!provider.configured && !provider.enabled) {
      setExpandedId(provider.id);
      setNotice(`先为 ${provider.name} 填写密钥，保存后即可启用。`);
      return;
    }
    const api = window.syncThink?.runtime;
    if (!api?.saveWebSearchProvider || busyId) return;
    const previous = providers;
    const enabled = !provider.enabled;
    setProviders((current) =>
      current.map((entry) => (entry.id === provider.id ? { ...entry, enabled } : entry)),
    );
    setBusyId(provider.id);
    setError(undefined);
    try {
      const response = await api.saveWebSearchProvider({ providerId: provider.id, enabled });
      setProviders((current) =>
        current.map((entry) => (entry.id === provider.id ? response.provider : entry)),
      );
      setNotice(`${provider.name} 已${enabled ? '启用' : '停用'}。`);
    } catch (reason) {
      setProviders(previous);
      setError(reason instanceof Error ? reason.message : '更新搜索服务失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= providers.length) return;
    const api = window.syncThink?.runtime;
    if (!api?.reorderWebSearchProviders || busyId) return;
    const previous = providers;
    const next = [...providers];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    setProviders(next.map((provider, priority) => ({ ...provider, priority })));
    setBusyId(providers[index]!.id);
    setError(undefined);
    try {
      const response = await api.reorderWebSearchProviders({
        providerIds: next.map((provider) => provider.id),
      });
      setProviders(response.providers);
    } catch (reason) {
      setProviders(previous);
      setError(reason instanceof Error ? reason.message : '调整搜索优先级失败。');
    } finally {
      setBusyId(undefined);
    }
  };

  const replaceProvider = (provider: WebSearchProviderSummary) => {
    setProviders((current) =>
      current.map((entry) => (entry.id === provider.id ? provider : entry)),
    );
  };

  return (
    <section className="settings-web-search" aria-label="搜索服务设置">
      <header className="settings-web-search__header">
        <div>
          <h2>搜索服务</h2>
          <p>
            模型和内核支持原生联网时优先使用原生搜索；否则调用这里启用的服务。启用多个服务后按顺序尝试，最后使用内置搜索兜底。
          </p>
        </div>
        <span>
          {providers.filter((provider) => provider.enabled && provider.configured).length} 个已启用
        </span>
      </header>

      {notice ? (
        <p className="settings-web-search__notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="settings-web-search__notice is-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="settings-web-search__loading">
          <LoaderCircle size={16} className="is-spinning" aria-hidden="true" />
          正在读取搜索服务…
        </div>
      ) : (
        <div className="settings-web-search__list">
          {providers.map((provider, index) => {
            const expanded = expandedId === provider.id;
            return (
              <div
                key={provider.id}
                className={clsx('settings-web-search__item', expanded && 'is-expanded')}
              >
                <div className="settings-web-search__row">
                  <span
                    className="settings-web-search__priority"
                    aria-label={`优先级 ${index + 1}`}
                  >
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    className="settings-web-search__identity"
                    aria-label={`配置 ${provider.name}`}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? undefined : provider.id)}
                  >
                    <span className="settings-web-search__mark" aria-hidden="true">
                      {provider.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{provider.name}</strong>
                      <small>{provider.description}</small>
                    </span>
                    <span
                      className={clsx(
                        'settings-web-search__status',
                        provider.configured && 'is-ready',
                      )}
                    >
                      {provider.configured ? (provider.enabled ? '使用中' : '已配置') : '未配置'}
                    </span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                  <div
                    className="settings-web-search__order"
                    aria-label={`${provider.name} 优先级`}
                  >
                    <button
                      type="button"
                      aria-label={`上移 ${provider.name}`}
                      disabled={index === 0 || Boolean(busyId)}
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUp size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`下移 ${provider.name}`}
                      disabled={index === providers.length - 1 || Boolean(busyId)}
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDown size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <SearchToggle
                    checked={provider.enabled}
                    disabled={busyId === provider.id}
                    label={`${provider.name} 搜索`}
                    onChange={() => void toggle(provider)}
                  />
                </div>
                {expanded ? (
                  <WebSearchProviderEditor
                    key={`${provider.id}:${provider.updatedAt ?? 'new'}`}
                    provider={provider}
                    busy={busyId === provider.id}
                    onBusy={setBusyId}
                    onSaved={(updated, message) => {
                      replaceProvider(updated);
                      setNotice(message);
                      setError(undefined);
                    }}
                    onTested={(result) => {
                      setNotice(
                        result.ok
                          ? `${provider.name} 连接正常，${result.elapsedMs}ms 返回 ${result.resultCount} 条结果。`
                          : undefined,
                      );
                      setError(
                        result.ok ? undefined : (result.error ?? `${provider.name} 测试失败。`),
                      );
                    }}
                    onError={setError}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WebSearchProviderEditor({
  provider,
  busy,
  onBusy,
  onSaved,
  onTested,
  onError,
}: {
  provider: WebSearchProviderSummary;
  busy: boolean;
  onBusy(id: WebSearchProviderId | undefined): void;
  onSaved(provider: WebSearchProviderSummary, message: string): void;
  onTested(result: TestWebSearchProviderResponse): void;
  onError(message: string): void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [engineId, setEngineId] = useState(provider.engineId ?? '');
  const [endpoint, setEndpoint] = useState(provider.endpoint ?? '');
  const [reveal, setReveal] = useState(false);

  const credentials = {
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    ...(secretKey.trim() ? { secretKey: secretKey.trim() } : {}),
    ...(engineId.trim() ? { engineId: engineId.trim() } : {}),
    ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
  };

  const save = async () => {
    const api = window.syncThink?.runtime;
    if (!api?.saveWebSearchProvider || busy) return;
    if (!provider.configured && !apiKey.trim()) {
      onError('请填写 API Key 后再保存。');
      return;
    }
    onBusy(provider.id);
    try {
      const response = await api.saveWebSearchProvider({
        providerId: provider.id,
        enabled: true,
        ...credentials,
      });
      setApiKey('');
      setSecretKey('');
      onSaved(response.provider, `${provider.name} 已保存并启用。`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '保存搜索服务失败。');
    } finally {
      onBusy(undefined);
    }
  };

  const test = async () => {
    const api = window.syncThink?.runtime;
    if (!api?.testWebSearchProvider || busy) return;
    onBusy(provider.id);
    try {
      onTested(await api.testWebSearchProvider({ providerId: provider.id, ...credentials }));
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '测试搜索服务失败。');
    } finally {
      onBusy(undefined);
    }
  };

  const clear = async () => {
    const api = window.syncThink?.runtime;
    if (!api?.saveWebSearchProvider || busy) return;
    onBusy(provider.id);
    try {
      const response = await api.saveWebSearchProvider({
        providerId: provider.id,
        enabled: false,
        clearApiKey: true,
        clearSecretKey: true,
      });
      onSaved(response.provider, `${provider.name} 的密钥已移除。`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '移除密钥失败。');
    } finally {
      onBusy(undefined);
    }
  };

  return (
    <div className="settings-web-search__editor">
      <label>
        <span>{provider.id === 'doubao' ? 'Access Key / API Key' : 'API Key'}</span>
        <span className="settings-web-search__secret-field">
          <KeyRound size={13} aria-hidden="true" />
          <input
            type={reveal ? 'text' : 'password'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider.configured ? '留空以继续使用已保存的密钥' : '输入 API Key'}
            autoComplete="off"
          />
          <button
            type="button"
            aria-label={reveal ? '隐藏密钥' : '显示密钥'}
            onClick={() => setReveal((value) => !value)}
          >
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </span>
      </label>
      {provider.id === 'doubao' ? (
        <label>
          <span>Secret Key（AK/SK 模式）</span>
          <input
            type="password"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            placeholder="可选"
            autoComplete="off"
          />
        </label>
      ) : null}
      {provider.requiresEngineId ? (
        <label>
          <span>搜索引擎 ID</span>
          <input
            value={engineId}
            onChange={(event) => setEngineId(event.target.value)}
            placeholder="Programmable Search Engine ID"
          />
        </label>
      ) : null}
      <label className="settings-web-search__endpoint">
        <span>自定义接口地址（可选）</span>
        <input
          type="url"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="使用官方默认地址"
        />
      </label>
      <div className="settings-web-search__actions">
        {provider.configured ? (
          <button type="button" className="is-danger" disabled={busy} onClick={() => void clear()}>
            <Trash2 size={13} aria-hidden="true" />
            移除密钥
          </button>
        ) : (
          <span />
        )}
        <button type="button" disabled={busy} onClick={() => void test()}>
          <Search size={13} aria-hidden="true" />
          测试
        </button>
        <button type="button" className="is-primary" disabled={busy} onClick={() => void save()}>
          {busy ? <LoaderCircle size={13} className="is-spinning" /> : <Check size={13} />}
          保存并启用
        </button>
      </div>
    </div>
  );
}

function SearchToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange(): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={clsx('settings-toggle', checked && 'is-checked')}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
