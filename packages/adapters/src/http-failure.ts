/**
 * 中转站把自己上游的故障包在 4xx 里返回时，需要按「服务端可重试」处理。
 *
 * 典型样本（Atria 网关，实测）：
 *   HTTP 400 {"error":{"message":"Inference request failed.",
 *                       "type":"atria_api_error","code":"upstream_error"}}
 *
 * 这类响应与「你的请求非法」共用同一个状态码，光看 4xx 无法区分。若按 protocol
 * 处理，运行时会把整轮 run 停住并要求用户换模型/换 Provider；实际它是上游抖动，
 * 重试或走备用模型链就能恢复。
 */
export function isUpstreamFailureSnippet(snippet: string): boolean {
  if (!snippet) return false;
  const text = snippet.toLowerCase();
  return (
    text.includes('upstream_error') ||
    text.includes('upstream request failed') ||
    text.includes('upstream service temporarily unavailable') ||
    text.includes('inference request failed')
  );
}
