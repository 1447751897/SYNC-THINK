import { useState } from 'react';
import { Database, Folder, Github, Globe2, Server } from 'lucide-react';
import { resolveMcpLogoSources, type McpMark } from './mcp-identity.js';

const MCP_LOGO_PREFERENCE_KEY = 'sync-think:mcp-logo-source:v2:';
const NO_REMOTE_LOGO = 'none';

function readLogoPreference(id: string, sources: readonly string[]): number {
  try {
    const source = window.localStorage.getItem(`${MCP_LOGO_PREFERENCE_KEY}${id}`);
    if (source === NO_REMOTE_LOGO) return sources.length;
    const index = sources.indexOf(source ?? '');
    return index < 0 ? 0 : index;
  } catch {
    return 0;
  }
}

function rememberLogoPreference(id: string, source: string): void {
  if (!source.startsWith('https://') && source !== NO_REMOTE_LOGO) return;
  try {
    window.localStorage.setItem(`${MCP_LOGO_PREFERENCE_KEY}${id}`, source);
  } catch {
    // Private storage or a full quota must never prevent an icon from rendering.
  }
}

const MCP_MARK_ICON: Record<McpMark, typeof Server> = {
  github: Github,
  folder: Folder,
  globe: Globe2,
  database: Database,
  server: Server,
};

/**
 * MCP / 连接器统一身份图标。
 * 已知 MCP 图标随应用打包；其他站点记住可用的 favicon 来源并逐级降级，
 * 因此不会出现空白或裂图。MCP 管理页与设置里的连接器共用这一个来源。
 */
export function McpIdentityMark(props: {
  name?: string;
  endpoint?: string;
  size?: number;
}): JSX.Element {
  const size = props.size ?? 15;
  const { id, mark, sources } = resolveMcpLogoSources(props);
  // 降级进度跟着标识走：换了一个服务就从第一档重新开始尝试。
  const [failed, setFailed] = useState<{ id: string; count: number }>(() => ({
    id,
    count: readLogoPreference(id, sources),
  }));
  const attempt = failed.id === id ? failed.count : readLogoPreference(id, sources);
  const src = sources[attempt];
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        data-testid={`mcp-icon-${id}`}
        onLoad={() => rememberLogoPreference(id, src)}
        onError={() => {
          rememberLogoPreference(id, sources[attempt + 1] ?? NO_REMOTE_LOGO);
          setFailed({ id, count: attempt + 1 });
        }}
      />
    );
  }
  const Icon = MCP_MARK_ICON[mark];
  return <Icon size={size} data-testid={`mcp-icon-${id}`} />;
}
