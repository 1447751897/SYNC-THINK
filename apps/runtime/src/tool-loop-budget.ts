/** Host-owned native execution budgets, not a limit on productive model rounds. */
export const NATIVE_TOOL_CALL_BUDGET = 128;
export const NATIVE_OUTPUT_TOKEN_BUDGET = 64_000;
/** Reserve one bounded, tool-free summary after a stop condition. */
export const NATIVE_FINAL_TOKEN_BUDGET = 2_048;

export interface ToolLoopBudgetUsage {
  toolCallsUsed: number;
  outputTokensUsed: number;
}

/** Checked before every side effect, including approval requests and delegation. */
export function toolLoopBudgetReason(usage: ToolLoopBudgetUsage): string | undefined {
  if (usage.toolCallsUsed >= NATIVE_TOOL_CALL_BUDGET) {
    return '本次执行已用完操作预算（' + NATIVE_TOOL_CALL_BUDGET + ' 次工具操作）。停止新操作并汇总已完成内容、待办与续做步骤；不要宣称未执行的操作已完成。';
  }
  if (usage.outputTokensUsed >= NATIVE_OUTPUT_TOKEN_BUDGET) {
    return '本次执行已用完生成预算（' + NATIVE_OUTPUT_TOKEN_BUDGET + ' 输出 Token）。停止新操作并汇总已完成内容、待办与续做步骤；不要宣称未执行的操作已完成。';
  }
  return undefined;
}
