import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import beautifulUiIcon from './assets/connectors/beautiful-ui.png';
import { SYNC_THINK_CONNECTOR_CATALOG } from './connector-catalog.js';

const CONNECTOR_DOMAINS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['youtube', ['youtube.com', 'youtu.be']],
  ['reddit', ['reddit.com']],
  ['linkedin', ['linkedin.com']],
  ['instagram', ['instagram.com']],
  ['tiktok', ['tiktok.com']],
  ['x-twitter', ['x.com', 'twitter.com']],
  ['zhihu', ['zhihu.com']],
  ['bilibili', ['bilibili.com', 'b23.tv']],
  ['weibo', ['weibo.com']],
  ['xiaohongshu', ['xiaohongshu.com', 'xhslink.com']],
  ['douyin', ['douyin.com']],
  ['kuaishou', ['kuaishou.com']],
  ['toutiao', ['toutiao.com']],
  ['xigua', ['ixigua.com']],
  ['threads', ['threads.net']],
  ['telegram', ['t.me', 'telegram.org']],
];

const connectorById = new Map(SYNC_THINK_CONNECTOR_CATALOG.map((item) => [item.id, item]));

const SOURCE_SITE_DOMAINS: ReadonlyArray<{
  id: string;
  name: string;
  icon: string;
  domains: readonly string[];
}> = [
  {
    id: 'beautiful-ui',
    name: 'Beautiful UI',
    icon: beautifulUiIcon,
    domains: ['beautifului.dev'],
  },
];

export interface ExternalSourceDescriptor {
  host: string;
  connectorId?: string;
  connectorName?: string;
  icon?: string;
}

function normalizedHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function describeExternalSource(url: string): ExternalSourceDescriptor {
  const host = normalizedHost(url);
  const sourceSite = SOURCE_SITE_DOMAINS.find((site) =>
    site.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  );
  if (sourceSite) {
    return {
      host,
      connectorId: sourceSite.id,
      connectorName: sourceSite.name,
      icon: sourceSite.icon,
    };
  }
  const connectorId = CONNECTOR_DOMAINS.find(([, domains]) =>
    domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
  )?.[0];
  const connector = connectorId ? connectorById.get(connectorId) : undefined;
  return {
    host,
    ...(connector
      ? {
          connectorId: connector.id,
          connectorName: connector.name,
          icon: connector.icon,
        }
      : {}),
  };
}

export function siteFaviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function browserTabFaviconSrc(browser: { url: string; favicon?: string }): string | undefined {
  if (browser.favicon?.trim()) return browser.favicon.trim();
  try {
    const host = new URL(browser.url).hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return undefined;
    return siteFaviconUrl(host);
  } catch {
    return undefined;
  }
}

export function ExternalSourceIcon({
  url,
  size = 14,
  className,
}: {
  url: string;
  size?: number;
  className?: string;
}) {
  const source = describeExternalSource(url);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const remoteIcon =
    !source.icon && source.host.includes('.') && !remoteFailed
      ? siteFaviconUrl(source.host)
      : undefined;
  return (
    <span
      className={`shell-external-source-icon${className ? ` ${className}` : ''}`}
      data-source-connector={source.connectorId ?? 'web'}
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      {source.icon ? (
        <img src={source.icon} alt="" width={size} height={size} />
      ) : remoteIcon ? (
        <img
          src={remoteIcon}
          alt=""
          width={size}
          height={size}
          onError={() => setRemoteFailed(true)}
        />
      ) : (
        <Globe2 size={size} strokeWidth={1.8} />
      )}
    </span>
  );
}
