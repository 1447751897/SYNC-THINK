/**
 * Actionable recovery + known limitations catalog (product design §23.2 #9 / #12).
 * Pure helpers — safe for UI and unit tests without Runtime.
 */

export type FailureClassKey =
  | 'transient'
  | 'auth'
  | 'protocol'
  | 'permission'
  | 'acceptance'
  | 'rate-limit'
  | 'timeout'
  | 'unknown'
  | string;

export interface RecoveryGuide {
  /** Canonical or free-form failure class. */
  failureClass: string;
  /** Short Chinese label for chips / badges. */
  label: string;
  /** One-line meaning. */
  meaning: string;
  /** Whether automatic retry is generally appropriate. */
  retryable: boolean;
  /** Ordered recovery steps the user can take. */
  steps: readonly string[];
  /** Optional deep-link style target within the app IA. */
  goTo?: 'providers' | 'approvals' | 'agents' | 'settings' | 'memory';
}

export interface KnownLimitation {
  id: string;
  title: string;
  detail: string;
  area: 'provider' | 'protocol' | 'mcp' | 'security' | 'runtime';
}

const GUIDE_BY_CLASS: Record<string, Omit<RecoveryGuide, 'failureClass'>> = {
  transient: {
    label: '瞬时故障',
    meaning: '上游短暂不可用或网络抖动，通常可重试。',
    retryable: true,
    steps: [
      '稍后再次「发现模型」或重发同一任务',
      '检查本机网络 / 代理 / VPN 是否稳定',
      '若连续失败，打开 Providers 核对 baseURL 是否可达',
    ],
    goTo: 'providers',
  },
  auth: {
    label: '鉴权失败',
    meaning: '密钥无效、过期，或凭证组无权访问该模型。',
    retryable: false,
    steps: [
      '到 Providers 更新 API Key（密钥只进安全存储）',
      '确认网关账号是否启用、是否被吊销',
      '检查 Credential Group 是否绑定了正确的 Provider',
      '不要把密钥贴进聊天或导出文件',
    ],
    goTo: 'providers',
  },
  protocol: {
    label: '协议不匹配',
    meaning: '当前协议与网关实际接口不一致，或没有对应适配器。',
    retryable: false,
    steps: [
      '在 Providers 卡片核对 protocol（如 openai-chat / anthropic-messages）',
      '空目录发现依赖「已持久化的协议」，不是首个模型猜的',
      '若网关只支持 Chat Completions，勿选 Responses / Messages',
      '改协议后重新「发现模型」',
    ],
    goTo: 'providers',
  },
  permission: {
    label: '权限拒绝',
    meaning: '策略或白名单禁止了该操作（工具 / MCP / 敏感动作）。',
    retryable: false,
    steps: [
      '到 Agent 绑定检查 Skill / MCP 白名单',
      '敏感 MCP 工具需走审批中心，不会静默放行',
      '确认动作不在 human-only 列表的旁路路径上',
    ],
    goTo: 'agents',
  },
  acceptance: {
    label: '验收未通过',
    meaning: '输出未满足验收规则，不是网络错误。',
    retryable: false,
    steps: [
      '查看 Trace / Manifest 中的验收说明',
      '调整任务说明或 Agent 指令后重试',
      '勿把验收失败当作密钥问题',
    ],
  },
  'rate-limit': {
    label: '限流',
    meaning: '上游 QPS / 日配额触顶，需退避后再试。',
    retryable: true,
    steps: [
      '等待数分钟后重试（勿连续猛点发现）',
      '降低并行模型数或换备用 Provider',
      '在网关控制台核对配额',
    ],
    goTo: 'providers',
  },
  timeout: {
    label: '超时',
    meaning: '请求在限定时间内未完成。',
    retryable: true,
    steps: [
      '检查 baseURL 延迟与本机网络',
      '对长上下文任务减少报文体积后重试',
      '确认网关未挂起或防火墙拦截',
    ],
    goTo: 'providers',
  },
  unknown: {
    label: '未分类',
    meaning: '尚未归入标准失败类；摘要已脱敏。',
    retryable: false,
    steps: [
      '阅读诊断摘要中的脱敏信息',
      '对照 Providers 协议与密钥配置',
      '若可复现，保留诊断时间戳便于对照日志',
    ],
  },
  provider_error: {
    label: 'Provider 错误',
    meaning: '上游 Provider 返回错误（可能含鉴权或协议问题）。',
    retryable: false,
    steps: [
      '核对 API Key 与 baseURL',
      '确认 protocol 与网关一致',
      '查看完整脱敏摘要后再决定是否重试',
    ],
    goTo: 'providers',
  },
};

export const KNOWN_LIMITATIONS: readonly KnownLimitation[] = [
  {
    id: 'lim-protocol-persist',
    title: '发现按已存协议路由',
    detail:
      '模型发现使用 Provider 上持久化的 protocol；空目录时不会再靠「第一个模型」猜测。协议选错会直接记入 Diagnostics。',
    area: 'protocol',
  },
  {
    id: 'lim-cap-heuristic',
    title: '能力标签是启发式建议',
    detail:
      '探测给出的 vision / tool-calling 等标签仅为建议，确认前不是事实；不会自动改写 Agent 绑定。',
    area: 'provider',
  },
  {
    id: 'lim-mcp-discovery',
    title: 'MCP 发现 ≠ 可执行',
    detail:
      '刷新工具目录只写入 Schema，不改 Agent 白名单，也不执行 tools/call；真调用必须绑定 + 审批闸门。',
    area: 'mcp',
  },
  {
    id: 'lim-secrets',
    title: '密钥永不进库 / 日志',
    detail:
      'API Key 只进 SecureStore；数据库、Diagnostics、导出与事件载荷均为脱敏。无法从诊断反推明文密钥。',
    area: 'security',
  },
  {
    id: 'lim-m1-exit',
    title: 'M1 退出证据仍 open',
    detail:
      '外网真实网关 UI 手测 18/18 与 dogfood 1/1 均已完成；用户已确认一天即可，M1 已完成。本地 dual-gateway 自动化只作回归证据。',
    area: 'runtime',
  },
];

export function normalizeFailureClass(raw?: string | null): string {
  if (!raw) return 'unknown';
  const t = raw.trim().toLowerCase();
  if (!t) return 'unknown';
  if (t === 'rate_limit' || t === 'ratelimit') return 'rate-limit';
  if (t === 'provider-error' || t === 'providererror') return 'provider_error';
  return t;
}

export function getRecoveryGuide(failureClass?: string | null): RecoveryGuide {
  const key = normalizeFailureClass(failureClass);
  const base = GUIDE_BY_CLASS[key] ?? GUIDE_BY_CLASS.unknown!;
  return {
    failureClass: key,
    label: base.label,
    meaning: base.meaning,
    retryable: base.retryable,
    steps: base.steps,
    goTo: base.goTo,
  };
}

export function listKnownLimitations(area?: KnownLimitation['area']): readonly KnownLimitation[] {
  if (!area) return KNOWN_LIMITATIONS;
  return KNOWN_LIMITATIONS.filter((l) => l.area === area);
}
