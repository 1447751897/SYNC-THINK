import type { GoalStatus } from '@sync-think/protocol';

/** NewMax goal defaults; both limits prevent an unbounded autonomous loop. */
export const DEFAULT_GOAL_MAX_ROUNDS = 10;
export const DEFAULT_GOAL_MAX_TOKENS = 1_000_000;

export type GoalTurnStatus = 'complete' | 'continue' | 'blocked';

const GOAL_STATUS_PATTERN = /GOAL_STATUS\s*[：:]\s*(complete|blocked|continue)/gi;
const GOAL_STATUS_LINE_PATTERN =
  /^[ \t`*#>-]*GOAL_STATUS\s*[：:]\s*(?:complete|blocked|continue)[ \t`*]*$/gim;

/** NewMax Goal protocol: the last status marker in the work model's final answer wins. */
export function parseGoalTurnStatus(text: string): GoalTurnStatus | undefined {
  let status: GoalTurnStatus | undefined;
  for (const match of text.matchAll(GOAL_STATUS_PATTERN)) {
    status = match[1]?.toLowerCase() as GoalTurnStatus | undefined;
  }
  return status;
}

/** Remove standalone Goal control lines from user-visible final answer text. */
export function stripGoalStatus(text: string): string {
  const stripped = text.replace(GOAL_STATUS_LINE_PATTERN, '');
  return stripped === text ? text : stripped.replace(/\s+$/, '');
}

function goalStatusInstruction(chinese: boolean): string {
  return chinese
    ? '本轮结束时，最后单独一行输出状态标记 `GOAL_STATUS: complete` / `GOAL_STATUS: continue` / `GOAL_STATUS: blocked`：仅当目标每条要求都有证据证明已满足、且要求的内容已完整写在你的回复正文里、经得起逐条核对时才用 complete；只有确实需要人工介入、或必须修改实现方案、自己无法继续推进时才用 blocked，不要第一次遇到困难就用 blocked；其余情况一律用 continue 继续工作，不要因为想停下或预算将尽就声称完成或受阻。'
    : 'At the end of this turn, output one final standalone status line: `GOAL_STATUS: complete` / `GOAL_STATUS: continue` / `GOAL_STATUS: blocked`. Use complete only when every requirement has evidence, the required content is fully present in your reply body, and it can survive item-by-item review. Use blocked only when human intervention is truly required, the approach must change, or you cannot continue on your own; do not mark blocked at the first difficulty. Use continue in all other cases, and never report complete or blocked just because you want to stop or the budget is running low.';
}

/** Work-model prompt for each Goal round, including the optional stopping condition. */
export function formatGoalTurnModelPrompt(goal: GoalStatus): string {
  const round = (goal.roundsStarted ?? 0) + 1;
  const maxRounds = goal.maxGoalRounds ?? DEFAULT_GOAL_MAX_ROUNDS;
  const tokenBudget = goal.maxGoalTokens ?? DEFAULT_GOAL_MAX_TOKENS;
  const chinese = /[\u3400-\u9fff]/u.test(`${goal.condition}${goal.stopCondition ?? ''}`);
  const stopping = goal.stopCondition
    ? chinese
      ? `停止条件：${goal.stopCondition}。`
      : `Stopping condition: ${goal.stopCondition}. `
    : '';
  if (round === 1) {
    return chinese
      ? `[Goal 模式] 目标：${goal.condition}。${stopping}最多 ${maxRounds} 轮，token 预算 ${tokenBudget}。请从本轮起，直接在回复正文中按顺序逐步产出目标要求的实际内容、边做边推进；不要把整轮时间花在创建或更新任务清单等管理动作上，完成与否以正文是否实际覆盖目标为准。${goalStatusInstruction(true)}`
      : `[Goal mode] Goal: ${goal.condition}. ${stopping}Maximum ${maxRounds} iterations, token budget ${tokenBudget}. Starting this turn, produce the actual content required by the goal directly in the reply body, step by step and in order. Do not spend the whole turn creating or updating task lists or other management artifacts. Completion is judged by whether the reply body actually covers the goal. ${goalStatusInstruction(false)}`;
  }
  return chinese
    ? `[Goal 第 ${round} 轮] 目标：${goal.condition}。${stopping}请核对你在本对话中已输出的回复正文，逐条对照目标的全部要求：仍有未覆盖的部分，就在本轮正文按顺序继续产出，不要跳步、不要重复已讲过的内容；只有当正文确已完整覆盖目标每一项要求时，才输出 GOAL_STATUS: complete。${goalStatusInstruction(true)}`
    : `[Goal round ${round}] Goal: ${goal.condition}. ${stopping}Review the reply body already produced in this conversation against every requirement. Continue with only the uncovered work, without skipping steps or repeating completed content. Use GOAL_STATUS: complete only after the reply body fully covers the goal. ${goalStatusInstruction(false)}`;
}

/** User-facing message persisted for each automatic goal round. */
export function formatGoalTurnUserMessage(goal: GoalStatus): string {
  const round = (goal.roundsStarted ?? 0) + 1;
  const maxRounds = goal.maxGoalRounds ?? DEFAULT_GOAL_MAX_ROUNDS;
  return round === 1
    ? goal.condition
    : `继续目标（第 ${round}/${maxRounds} 轮）：${
        goal.lastReason ? `处理上一轮未完成项：${goal.lastReason}` : goal.condition
      }`;
}
