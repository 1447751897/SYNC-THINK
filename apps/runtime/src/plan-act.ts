/**
 * plan/exec 双模型路由（plan-act setting）。
 *
 * 设置（app-setting 'plan-act'，由「设置 → 模型 → 规划 & 执行模型」面板维护）：
 *   { enabled, planModelId, actModelId, planReasoningEffort, actReasoningEffort }
 *
 * 路由规则（对话级 interactionMode 驱动，run 创建前强制生效）：
 *   - 规划模式（interactionMode === 'plan'）且配置了 planModelId
 *     → 本轮强制使用规划模型（+ 可选的规划思考强度）；
 *   - 执行模式（interactionMode === 'execute'）且配置了 actModelId
 *     → 本轮强制使用执行模型（+ 可选的执行思考强度）；
 *   - 未启用 / 未配置 → 不干预，走现有模型解析链（手动覆盖 / Agent 默认）。
 *
 * 纯函数，便于单元测试；runtime 只在 prepareRunBinding 中做薄接线。
 */

export const PLAN_ACT_SETTING_KEY = 'plan-act';

export interface PlanActSettingValue {
  enabled?: boolean;
  planModelId?: string | null;
  actModelId?: string | null;
  planReasoningEffort?: string | null;
  actReasoningEffort?: string | null;
}

export type PlanActRole = 'plan' | 'act';

export interface PlanActRoute {
  /** 是否生效（enabled 且对应角色配置了模型）。 */
  applied: boolean;
  /** 生效的角色（plan / act）；未生效时为 null。 */
  role: PlanActRole | null;
  /** 强制使用的模型 id（catalog model id，与设置面板下拉一致）。 */
  modelId?: string;
  /** 强制的思考强度（auto/off/low/medium/high…），未配置时为空。 */
  reasoningEffort?: string;
}

export function parsePlanActSetting(raw: unknown): PlanActSettingValue {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    planModelId: typeof o.planModelId === 'string' && o.planModelId ? o.planModelId : null,
    actModelId: typeof o.actModelId === 'string' && o.actModelId ? o.actModelId : null,
    planReasoningEffort:
      typeof o.planReasoningEffort === 'string' && o.planReasoningEffort
        ? o.planReasoningEffort
        : null,
    actReasoningEffort:
      typeof o.actReasoningEffort === 'string' && o.actReasoningEffort
        ? o.actReasoningEffort
        : null,
  };
}

export function resolvePlanActRouting(
  setting: PlanActSettingValue,
  planningMode: boolean,
): PlanActRoute {
  if (setting.enabled !== true) return { applied: false, role: null };
  if (planningMode) {
    const modelId = setting.planModelId?.trim();
    if (!modelId) return { applied: false, role: null };
    return {
      applied: true,
      role: 'plan',
      modelId,
      ...(setting.planReasoningEffort?.trim()
        ? { reasoningEffort: setting.planReasoningEffort.trim() }
        : {}),
    };
  }
  const modelId = setting.actModelId?.trim();
  if (!modelId) return { applied: false, role: null };
  return {
    applied: true,
    role: 'act',
    modelId,
    ...(setting.actReasoningEffort?.trim()
      ? { reasoningEffort: setting.actReasoningEffort.trim() }
      : {}),
  };
}

/**
 * 三态路由选择（run 创建前调用）：
 *   - 规划模式（interactionMode === 'plan'）→ 规划模型；
 *   - 执行已批准方案的轮次（planExecuting 标志）→ 执行模型；
 *   - 其他（普通 execute 模式消息）→ 不干预，走手动覆盖 / Agent 默认链。
 * 规划模式优先于 planExecuting（规划轮绝不可能是执行轮）。
 */
export function resolvePlanActRouteForContext(
  setting: PlanActSettingValue,
  context: { planningMode: boolean; planExecuting: boolean },
): PlanActRoute {
  if (context.planningMode) return resolvePlanActRouting(setting, true);
  if (context.planExecuting) return resolvePlanActRouting(setting, false);
  return { applied: false, role: null };
}
