function unwrapRuntimeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return raw
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^RuntimeResponseError:\s*/i, '')
    .trim();
}

export function formatProviderDiscoveryError(error: unknown): string {
  const detail = unwrapRuntimeError(error);

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(detail)) {
    return (
      '无法解析网关域名（DNS）。请检查：1) Base URL 域名是否正确；' +
      '2) 系统/代理 DNS（Clash 等）是否让 Node 也能解析；' +
      '3) 尝试关闭 Fake-IP 或给 Runtime 配置可用 DNS。' +
      '发现模型会在 Base URL 后请求 /models。'
    );
  }
  if (/network error|fetch failed|ECONNREFUSED|ECONNRESET/i.test(detail)) {
    return (
      '无法连接模型网关。请检查 Base URL、域名解析、系统代理/TLS 和网关是否在线；' +
      '发现模型会在 Base URL 后请求 /models。'
    );
  }
  if (/timed out|timeout|AbortError/i.test(detail)) {
    return '模型网关响应超时。请检查网络与 Base URL，或稍后重试。';
  }
  if (/auth failed|\b401\b|\b403\b/i.test(detail)) {
    return 'Provider 密钥或网关授权失败。请检查 API Key、凭证组和网关访问策略。';
  }
  if (/rate limited|\b429\b/i.test(detail)) {
    return '模型发现请求过于频繁，网关已限流。请稍后重试。';
  }
  if (/non-JSON/i.test(detail)) {
    return '模型网关返回的不是 JSON。请确认 Base URL 指向兼容 API，而不是网站首页。';
  }
  if (/rejected \(404\)|\b404\b/i.test(detail)) {
    return '模型列表接口不存在。请确认 Base URL 是否需要包含 /v1；发现模型会请求 /models。';
  }

  return detail ? `模型发现失败：${detail}` : '模型发现失败';
}
