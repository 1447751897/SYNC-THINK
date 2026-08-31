import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { McpServerSummary } from '@sync-think/protocol';
import { useNewMaxPopoverPresence } from './NewMaxComposerFrame.js';

type ComposerMcpServer = McpServerSummary & {
  description?: string;
  type?: string;
  isBuiltin?: boolean;
  _newmax?: { isBuiltin?: boolean };
};

function isBuiltinMcpServer(server: ComposerMcpServer): boolean {
  if (typeof server.isBuiltin === 'boolean') return server.isBuiltin;
  if (typeof server._newmax?.isBuiltin === 'boolean') return server._newmax.isBuiltin;
  return /^(?:mcp[-_:])?builtin(?:[-_:]|$)/i.test(server.mcpServerId);
}

function mcpServerDescription(server: ComposerMcpServer): string {
  return (
    server.description?.trim() ||
    server.notes.trim() ||
    `${(server.type?.trim() || server.transport).toLocaleUpperCase()} MCP 服务器`
  );
}

export interface ComposerMcpMenuProps {
  open?: boolean;
  onDismiss(): void;
  onOpenSettings(): void;
  className?: string;
  style?: CSSProperties;
}

export function ComposerMcpMenu({
  open = true,
  onDismiss,
  onOpenSettings,
  className = '',
  style,
}: ComposerMcpMenuProps) {
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const menuPresence = useNewMaxPopoverPresence(open);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listMcpServers) {
      setLoading(false);
      setError('当前桌面版本未提供 MCP 状态');
      return;
    }
    void runtime
      .listMcpServers({ limit: 100 })
      .then((response) => {
        if (!cancelled) setServers(response.servers);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : '读取 MCP 状态失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!menuPresence.rendered) return null;

  const visibleServers = servers.filter(
    (server) => !isBuiltinMcpServer(server as ComposerMcpServer),
  );

  return (
    <>
      <button
        type="button"
        className="shell-composer-popover-backdrop"
        aria-label="关闭 MCP 状态"
        aria-hidden={menuPresence.phase === 'exiting' ? 'true' : undefined}
        data-motion-state={menuPresence.phase}
        tabIndex={menuPresence.phase === 'exiting' ? -1 : 0}
        onClick={onDismiss}
      />
      <section
        className={`shell-composer-mcp-menu ${className}`.trim()}
        style={style}
        data-testid="composer-mcp-menu"
        data-motion-state={menuPresence.phase}
        aria-label="MCP 服务器状态"
        aria-hidden={menuPresence.phase === 'exiting' ? 'true' : undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) menuPresence.completeMotion();
        }}
      >
        <header>
          <div className="shell-composer-mcp-menu__heading">
            <strong>MCP 服务器</strong>
            <span>启用状态在设置中管理</span>
          </div>
          <button
            type="button"
            aria-label="去 MCP 设置"
            onClick={() => {
              onDismiss();
              onOpenSettings();
            }}
          >
            去设置
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </header>
        <div className="shell-composer-mcp-menu__list">
          {loading ? <p>正在读取服务状态...</p> : null}
          {!loading && error ? <p role="alert">{error}</p> : null}
          {!loading && !error && visibleServers.length === 0 ? <p>尚未配置 MCP 服务器</p> : null}
          {!loading
            ? visibleServers.map((server) => (
                <div className="shell-composer-mcp-menu__row" key={server.mcpServerId}>
                  <div>
                    <strong>{server.name}</strong>
                    <span>{mcpServerDescription(server as ComposerMcpServer)}</span>
                  </div>
                  <small className={server.enabled ? 'is-enabled' : ''}>
                    {server.enabled ? '已启用' : '已禁用'}
                  </small>
                </div>
              ))
            : null}
        </div>
      </section>
    </>
  );
}
