import { useState } from 'react';
import { Database, Folder, Github, Globe2, Server } from 'lucide-react';
import { resolveMcpLogoSources, type McpMark } from './mcp-identity.js';

const MCP_MARK_ICON: Record<McpMark, typeof Server> = {
  github: Github,
  folder: Folder,
  globe: Globe2,
  database: Database,
  server: Server,
};

/**
 * MCP / 连接器统一身份图标。
 * 取图链：站点 favicon → 公共 favicon 服务 → 语义矢量图标；任一级加载失败自动降级，
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
  const [failed, setFailed] = useState<{ id: string; count: number }>({ id, count: 0 });
  const attempt = failed.id === id ? failed.count : 0;
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
        onError={() => setFailed({ id, count: attempt + 1 })}
      />
    );
  }
  const Icon = MCP_MARK_ICON[mark];
  return <Icon size={size} data-testid={`mcp-icon-${id}`} />;
}
