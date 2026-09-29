import { createProxyAwareFetch } from '@sync-think/adapters';

/** External kernels must use the same outbound proxy as provider connection tests. */
export function createGatewayUpstreamFetch(): typeof fetch {
  // Lazy initialization avoids reading system proxy settings until an external request.
  let remoteFetch: ReturnType<typeof createProxyAwareFetch> | undefined;
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    // Local providers stay local even when a system proxy is enabled.
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '[::1]' ||
      /^127\.\d+\.\d+\.\d+$/.test(host)
    ) {
      return fetch(input, init);
    }
    remoteFetch ??= createProxyAwareFetch();
    return remoteFetch(input, init);
  };
}

const NETWORK_FAILURES: Record<string, string> = {
  ENOTFOUND: '服务地址解析失败，请检查 DNS 或代理配置',
  EAI_AGAIN: 'DNS 暂时没有响应，请稍后重试或检查代理配置',
  ECONNREFUSED: '连接被拒绝，请检查服务地址和本地代理是否正在运行',
  ECONNRESET: '连接被中断，请检查网络或代理状态',
  ETIMEDOUT: '连接超时，请检查网络或代理状态',
  UND_ERR_CONNECT_TIMEOUT: '连接超时，请检查网络或代理状态',
  UND_ERR_SOCKET: '网络连接提前关闭，请检查网络或代理状态',
  ERR_TLS_CERT_ALTNAME_INVALID: '服务的 TLS 证书与地址不匹配',
  CERT_HAS_EXPIRED: '服务的 TLS 证书已过期',
  DEPTH_ZERO_SELF_SIGNED_CERT: '服务使用了未受信任的自签名证书',
  SELF_SIGNED_CERT_IN_CHAIN: '服务的 TLS 证书链包含未受信任的自签名证书',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '服务的 TLS 证书链验证失败',
};

/** Keep useful transport codes without exposing URLs, headers or nested error bodies. */
export function formatGatewayUpstreamError(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  const reasons: string[] = [];
  while (pending.length && seen.size < 16) {
    const next = pending.shift();
    if (!next || typeof next !== 'object' || seen.has(next)) continue;
    seen.add(next);
    const entry = next as { code?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof entry.code === 'string' && NETWORK_FAILURES[entry.code]) {
      const reason = NETWORK_FAILURES[entry.code] + ' (' + entry.code + ')';
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    if (entry.cause) pending.push(entry.cause);
    if (Array.isArray(entry.errors)) pending.push(...entry.errors.slice(0, 8));
  }
  if (reasons.length) return '模型网关连接失败：' + reasons.join('；');
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return error.name === 'TimeoutError'
      ? '模型网关请求超时，请检查网络或代理状态'
      : '模型网关请求已中止';
  }
  let message = error instanceof Error ? error.message : 'gateway upstream failure';
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
  if (message === 'fetch failed')
    return '模型网关连接失败 (fetch failed)，请检查服务地址、网络或代理配置';
  return message;
}
