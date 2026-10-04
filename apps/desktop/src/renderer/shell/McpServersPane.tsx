import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, Pencil, Plus, RefreshCw, Server, Trash2, Upload, X } from 'lucide-react';
import type { McpServerSummary } from '@sync-think/protocol';
import { ToggleControl } from './ToggleControl.js';
import { isManagedMcpServer, parseMcpImport, stdioConfig, type McpConfig } from './mcp-config.js';

interface Props {
  servers: McpServerSummary[];
  loading: boolean;
  error?: string;
  onChanged(): Promise<void>;
  onToggle(server: McpServerSummary, enabled: boolean): Promise<void>;
  busyId?: string;
}
export function McpServersPane({ servers, loading, error, onChanged, onToggle, busyId }: Props) {
  const [edit, setEdit] = useState<McpServerSummary | 'new'>();
  const [importOpen, setImportOpen] = useState(false);
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const operation = useRef(false);
  const dialogOpener = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const restoreDialogFocus = (event: Event) => {
    event.preventDefault();
    (dialogOpener.current?.isConnected ? dialogOpener.current : addButton.current)?.focus();
  };
  const save = async (config: McpConfig, existing?: McpServerSummary) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.registerMcpServer || !runtime.registerRemoteMcpServer)
      throw new Error('Runtime 连接不可用。');
    const shouldDiscover = config.enabled ?? existing?.enabled ?? true;
    const identity = existing ? { mcpServerId: existing.mcpServerId } : {};
    if (config.transport === 'local-stdio') {
      const result = await runtime.registerMcpServer({
        ...identity,
        name: config.name,
        transport: config.transport,
        endpoint: config.endpoint,
        notes: config.notes,
        trusted: existing?.trusted ?? false,
      });
      if (config.enabled !== undefined && config.enabled !== result.server.enabled)
        await runtime.setMcpServerEnabled({
          mcpServerId: result.server.mcpServerId,
          enabled: config.enabled,
        });
      if (!shouldDiscover) return '已保存 ' + config.name + '，服务器已停用。';
      try {
        await runtime.refreshMcpTools({ mcpServerId: result.server.mcpServerId, maxTools: 200 });
        return '已保存 ' + config.name + '，已刷新工具。';
      } catch (reason) {
        return (
          '已保存 ' +
          config.name +
          '；工具发现失败：' +
          (reason instanceof Error ? reason.message : '请检查启动命令。')
        );
      }
    }
    const result = await runtime.registerRemoteMcpServer({
      ...identity,
      name: config.name,
      endpoint: config.endpoint,
      notes: config.notes,
      ...(config.key ? { key: config.key } : {}),
      authScheme: config.authScheme ?? 'bearer',
      discoverTools: shouldDiscover,
      trusted: existing?.trusted ?? false,
    });
    if (config.enabled !== undefined && config.enabled !== result.server.enabled)
      await runtime.setMcpServerEnabled({
        mcpServerId: result.server.mcpServerId,
        enabled: config.enabled,
      });
    if (!shouldDiscover) return '已保存 ' + config.name + '，服务器已停用。';
    return result.discoveryError
      ? '已保存 ' + config.name + '；工具发现失败：' + result.discoveryError
      : '已保存 ' + config.name + '，发现 ' + result.server.tools.length + ' 个工具。';
  };
  const perform = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'MCP 配置失败。');
    } finally {
      await onChanged().catch(() => undefined);
      operation.current = false;
      setBusy(false);
    }
  };
  const visible = servers.filter((server) => !isManagedMcpServer(server));
  return (
    <section className="settings-mcp-pane" aria-label="MCP 服务器管理">
      <div className="settings-mcp-pane__head">
        <div>
          <h2>MCP 服务器</h2>
          <p>启用且发现工具后，普通对话自动可用；自定义 Agent / 小队仍按各自绑定使用。</p>
        </div>
        <div className="settings-mcp-pane__actions">
          <button
            type="button"
            aria-label="刷新 MCP"
            disabled={busy || Boolean(busyId) || loading}
            onClick={() => void onChanged()}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            disabled={busy || Boolean(busyId)}
            onClick={(event) => {
              dialogOpener.current = event.currentTarget;
              setImportOpen(true);
              setError(undefined);
            }}
          >
            <Upload size={15} />
            导入 JSON
          </button>
          <button
            type="button"
            disabled={busy || Boolean(busyId)}
            ref={addButton}
            onClick={(event) => {
              dialogOpener.current = event.currentTarget;
              setEdit('new');
              setError(undefined);
            }}
          >
            <Plus size={16} />
            添加服务器
          </button>
        </div>
      </div>
      {notice && (
        <p className="settings-connectors-notice" role="status">
          {notice}
        </p>
      )}
      {(localError || error) && (
        <p className="settings-connectors-notice is-error" role="alert">
          {localError || error}
        </p>
      )}
      <div className="settings-mcp-server-list" aria-busy={loading}>
        {loading ? (
          <p className="settings-connectors-empty">正在读取 MCP 服务器…</p>
        ) : !visible.length ? (
          <div className="settings-connectors-empty">
            <Server size={26} />
            <span>尚未添加 MCP 服务器</span>
            <small>导入 mcpServers JSON，或添加一个本地 / HTTP 服务器。</small>
          </div>
        ) : (
          visible.map((server) => {
            const local = server.transport === 'local-stdio';
            const config = local ? stdioConfig(server.endpoint) : undefined;
            return (
              <article key={server.mcpServerId} className="settings-mcp-server-card">
                <button
                  className="settings-mcp-server-card__body"
                  type="button"
                  aria-label={'配置 ' + server.name}
                  title="点击编辑服务器配置"
                  disabled={busy || Boolean(busyId)}
                  onClick={(event) => {
                    dialogOpener.current = event.currentTarget;
                    setEdit(server);
                    setError(undefined);
                  }}
                >
                  <span className="settings-mcp-server-card__title">
                    <strong>{server.name}</strong>
                    <span className="settings-mcp-transport">{local ? 'stdio' : 'http'}</span>
                    <Pencil
                      size={13}
                      className="settings-mcp-server-card__edit"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="settings-mcp-server-card__description">
                    {server.notes ||
                      (server.tools.length
                        ? '已发现 ' + server.tools.length + ' 个工具'
                        : '尚未发现工具，请检查配置或刷新工具')}
                  </span>
                  <span className="settings-mcp-server-card__meta">
                    {local ? (
                      <>
                        <span>
                          命令: <code>{config?.command}</code>
                        </span>
                        <span>
                          参数: <code>{config?.args.join(' ') || '无'}</code>
                        </span>
                        {config?.env && Object.keys(config.env).length > 0 && (
                          <span>{Object.keys(config.env).length} 个环境变量</span>
                        )}
                      </>
                    ) : (
                      <span>
                        地址: <code>{server.endpoint}</code>
                      </span>
                    )}
                  </span>
                </button>
                <ToggleControl
                  checked={server.enabled}
                  label={server.name + ' MCP'}
                  className="settings-toggle"
                  disabled={busy || Boolean(busyId)}
                  onChange={(enabled) => void onToggle(server, enabled)}
                />
              </article>
            );
          })
        )}
      </div>
      <Dialog.Root
        open={Boolean(edit)}
        onOpenChange={(open) => {
          if (!open && !busy) setEdit(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="settings-add-provider-overlay" />
          <Dialog.Content
            className="settings-add-provider-dialog"
            onCloseAutoFocus={restoreDialogFocus}
          >
            <div className="settings-add-provider-dialog__head">
              <div>
                <Dialog.Title>
                  {edit && edit !== 'new' ? '配置 ' + edit.name : '添加 MCP 服务器'}
                </Dialog.Title>
                <Dialog.Description>
                  普通对话无需额外绑定；自定义 Agent / 小队按绑定范围使用。
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="关闭 MCP 弹窗" disabled={busy}>
                <X size={17} />
              </Dialog.Close>
            </div>
            {edit && (
              <McpServerForm
                key={edit === 'new' ? 'new' : edit.mcpServerId}
                server={edit === 'new' ? undefined : edit}
                busy={busy}
                error={localError}
                onSave={(config) =>
                  void perform(async () => {
                    setNotice(await save(config, edit === 'new' ? undefined : edit));
                    setEdit(undefined);
                  })
                }
                onRefresh={
                  edit === 'new'
                    ? undefined
                    : () =>
                        void perform(async () => {
                          await window.syncThink!.runtime.refreshMcpTools({
                            mcpServerId: edit.mcpServerId,
                            maxTools: 200,
                          });
                          setNotice('已刷新 ' + edit.name + ' 的工具。');
                        })
                }
                onDelete={
                  edit === 'new'
                    ? undefined
                    : () => {
                        if (confirm('确定删除“' + edit.name + '”服务器吗？'))
                          void perform(async () => {
                            await window.syncThink!.runtime.deleteMcpServer({
                              mcpServerId: edit.mcpServerId,
                            });
                            setNotice('已删除 ' + edit.name + '。');
                            setEdit(undefined);
                          });
                      }
                }
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={importOpen}
        onOpenChange={(open) => {
          if (!busy) setImportOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="settings-add-provider-overlay" />
          <Dialog.Content
            className="settings-add-provider-dialog"
            onCloseAutoFocus={restoreDialogFocus}
          >
            <div className="settings-add-provider-dialog__head">
              <div>
                <Dialog.Title>导入 MCP JSON</Dialog.Title>
                <Dialog.Description>
                  支持 mcpServers 配置中的 command、args、env，或 url 与鉴权头。导入不会直接授予
                  Agent 权限。
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="关闭导入弹窗" disabled={busy}>
                <X size={17} />
              </Dialog.Close>
            </div>
            <form
              className="settings-connector-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  const configs = parseMcpImport(json);
                  let saved = 0;
                  const messages: string[] = [];
                  try {
                    for (const config of configs) {
                      messages.push(
                        await save(
                          config,
                          visible.find((server) => server.name === config.name),
                        ),
                      );
                      saved++;
                    }
                  } catch (reason) {
                    throw new Error(
                      '已导入 ' +
                        saved +
                        '/' +
                        configs.length +
                        ' 个服务器。' +
                        (reason instanceof Error ? reason.message : '保存失败'),
                    );
                  }
                  setNotice(messages.join(' '));
                  setImportOpen(false);
                  setJson('');
                });
              }}
            >
              <label>
                <span>JSON 配置</span>
                <textarea
                  aria-label="JSON 配置"
                  rows={9}
                  value={json}
                  disabled={busy}
                  onChange={(event) => setJson(event.target.value)}
                  placeholder={
                    '{ "mcpServers": { "boardui": { "command": "npx", "args": ["-y", "boardui@latest", "mcp"] } } }'
                  }
                  spellCheck={false}
                />
              </label>
              {localError && (
                <p role="alert" className="settings-connector-form__error">
                  {localError}
                </p>
              )}
              <div className="settings-connector-form__actions">
                <button type="button" disabled={busy} onClick={() => setImportOpen(false)}>
                  取消
                </button>
                <button type="submit" className="is-primary" disabled={busy || !json.trim()}>
                  {busy ? '正在导入' : '导入服务器'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
function McpServerForm({
  server,
  busy,
  error,
  onSave,
  onDelete,
  onRefresh,
}: {
  server?: McpServerSummary;
  busy: boolean;
  error?: string;
  onSave(config: McpConfig): void;
  onDelete?: () => void;
  onRefresh?: () => void;
}) {
  const local = server?.transport === 'local-stdio';
  const initial = local ? stdioConfig(server.endpoint) : undefined;
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<'local-stdio' | 'remote-http'>(
    local || !server ? 'local-stdio' : 'remote-http',
  );
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(JSON.stringify(initial?.args ?? []));
  const [env, setEnv] = useState(JSON.stringify(initial?.env ?? {}));
  const [endpoint, setEndpoint] = useState(local ? '' : (server?.endpoint ?? ''));
  const [notes, setNotes] = useState(server?.notes ?? '');
  const [key, setKey] = useState('');
  const [scheme, setScheme] = useState<'bearer' | 'api-key'>(
    server?.authScheme === 'api-key' ? 'api-key' : 'bearer',
  );
  const [validation, setValidation] = useState<string>();
  return (
    <form
      className="settings-connector-form"
      onSubmit={(event) => {
        event.preventDefault();
        setValidation(undefined);
        try {
          if (transport === 'local-stdio') {
            const config = parseMcpImport(
              JSON.stringify({
                mcpServers: {
                  [name]: {
                    command,
                    args: JSON.parse(args),
                    env: JSON.parse(env),
                    description: notes,
                  },
                },
              }),
            )[0]!;
            onSave(config);
          } else {
            const config = parseMcpImport(
              JSON.stringify({ mcpServers: { [name]: { url: endpoint, description: notes } } }),
            )[0]!;
            onSave({ ...config, key: key.trim() || undefined, authScheme: scheme });
          }
        } catch (reason) {
          setValidation(reason instanceof Error ? reason.message : '配置格式不正确。');
        }
      }}
    >
      <label>
        <span>服务器名称</span>
        <input
          aria-label="服务器名称"
          value={name}
          maxLength={128}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>传输方式</span>
        <select
          aria-label="传输方式"
          value={transport}
          disabled={busy}
          onChange={(event) => setTransport(event.target.value as typeof transport)}
        >
          <option value="local-stdio">本地（stdio）</option>
          <option value="remote-http">HTTP（支持 SSE 响应）</option>
        </select>
      </label>
      {transport === 'local-stdio' ? (
        <>
          <label>
            <span>命令</span>
            <input
              aria-label="命令"
              value={command}
              placeholder="npx"
              disabled={busy}
              onChange={(event) => setCommand(event.target.value)}
            />
          </label>
          <label>
            <span>参数（JSON 数组）</span>
            <input
              aria-label="参数"
              value={args}
              placeholder={'["-y", "boardui@latest", "mcp"]'}
              disabled={busy}
              onChange={(event) => setArgs(event.target.value)}
            />
          </label>
          <label>
            <span>环境变量（JSON 对象）</span>
            <textarea
              aria-label="环境变量"
              rows={2}
              value={env}
              disabled={busy}
              onChange={(event) => setEnv(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            <span>服务地址</span>
            <input
              aria-label="服务地址"
              value={endpoint}
              placeholder="https://example.com/mcp"
              disabled={busy}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <div className="settings-connector-form__auth-row">
            <label>
              <span>鉴权方式</span>
              <select
                aria-label="鉴权方式"
                value={scheme}
                disabled={busy}
                onChange={(event) => setScheme(event.target.value as typeof scheme)}
              >
                <option value="bearer">Bearer Token</option>
                <option value="api-key">X-API-Key</option>
              </select>
            </label>
            <label>
              <span>API Key</span>
              <input
                aria-label="API Key"
                type="password"
                autoComplete="new-password"
                value={key}
                disabled={busy}
                placeholder={server?.authConfigured ? '留空保留现有密钥' : '可选'}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
          </div>
        </>
      )}
      <label>
        <span>说明</span>
        <input
          aria-label="说明"
          value={notes}
          disabled={busy}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {(validation || error) && (
        <p className="settings-connector-form__error" role="alert">
          {validation || error}
        </p>
      )}
      <div className="settings-connector-form__actions">
        <div>
          {onDelete && (
            <button type="button" className="is-danger" disabled={busy} onClick={onDelete}>
              <Trash2 size={14} />
              删除服务器
            </button>
          )}
          {onRefresh && (
            <button type="button" disabled={busy} onClick={onRefresh}>
              <RefreshCw size={14} />
              刷新工具
            </button>
          )}
        </div>
        <button
          type="submit"
          className="is-primary"
          disabled={
            busy ||
            !name.trim() ||
            !(transport === 'local-stdio' ? command.trim() : endpoint.trim())
          }
        >
          {busy ? <LoaderCircle size={14} className="is-spinning" /> : null}
          {busy ? '正在保存' : '保存并连接'}
        </button>
      </div>
    </form>
  );
}
