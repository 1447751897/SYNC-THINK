/**
 * `platform` server — host infrastructure tools every kernel sees.
 *
 * These are the tools that tell the model about the platform, let it ask the
 * user, submit plans, manage the goal, and schedule tasks. They load
 * unconditionally (`alwaysLoad`): a model that cannot ask a question or submit
 * a plan is a broken model on every kernel.
 *
 * Tool semantics are identical to the legacy platform-tools definitions; the
 * executors live in the runtime (`executePlatformTool` + the runtime's own
 * handlers for ask/plan/goal/task_schedule).
 */
import type { KernelMcpServerDefinition } from './define-server.js';

export const PLATFORM_SERVER_NAME = 'platform';

/** JSON-Schema for the ask_user_question tool (mirrors platform-tools.ts). */
const ASK_USER_QUESTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'question'],
        properties: {
          id: { type: 'string', description: 'Stable id for this question; echoed in the answer.' },
          question: { type: 'string', description: 'The specific question to ask the user.' },
          header: {
            type: 'string',
            description: 'Optional short heading, e.g. "Confirm" or "Choose Mode".',
          },
          detail: { type: 'string', description: 'Optional Markdown detail / full plan text.' },
          intent: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', description: "'plan-review' renders the plan review card." },
              approve: { type: 'string', description: 'plan-review: the approve option label.' },
            },
          },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: {
                label: { type: 'string', description: 'Short user-facing option label.' },
                description: {
                  type: 'string',
                  description: 'One sentence explaining the tradeoff or impact.',
                },
              },
            },
          },
          multi_select: {
            type: 'boolean',
            description: 'Whether the user may select more than one option. Defaults to false.',
          },
        },
      },
    },
  },
};

/** JSON-Schema for plan_submit (mirrors platform-tools.ts §12.18). */
const PLAN_SUBMIT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'steps'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200, description: '方案标题' },
    goal: { type: 'string', maxLength: 5000, description: '方案目标' },
    scope: {
      type: 'array',
      items: { type: 'string' },
      description: '改动范围（明确不做的事也列在这里）',
    },
    assumptions: { type: 'array', items: { type: 'string' }, description: '前提假设' },
    decisions: { type: 'array', items: { type: 'string' }, description: '已做出的关键决策' },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'description', 'acceptanceChecks'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128, description: '稳定步骤 id' },
          title: { type: 'string', maxLength: 500, description: '步骤标题' },
          description: { type: 'string', maxLength: 5000, description: '步骤描述' },
          expectedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: '本步骤预计触动的文件',
          },
          acceptanceChecks: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', maxLength: 2000 },
            description: '本步骤完成的验收标准（可验证、可自检）',
          },
        },
      },
    },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'mitigation'],
        properties: {
          description: { type: 'string', maxLength: 2000, description: '风险描述' },
          mitigation: { type: 'string', maxLength: 2000, description: '缓解措施' },
        },
      },
    },
    finalAcceptanceChecks: {
      type: 'array',
      items: { type: 'string', maxLength: 2000 },
      description: '方案整体完成的验收标准',
    },
  },
};

export const platformServer: KernelMcpServerDefinition = {
  name: PLATFORM_SERVER_NAME,
  version: '1.0.0',
  alwaysLoad: true,
  tools: [
    {
      name: 'platform_context',
      description:
        'Identify the SYNC-THINK platform, the workspace the kernel is bound to, and the platform tools available on this channel.',
      approval: 'never',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ask_user_question',
      description:
        '向用户提问并等待回答（工具会挂起直到用户作答，回答作为工具结果返回）。需要用户确认、选择或补充信息时调用。推荐选项放第一位并在 label 末尾加「（推荐）」。规划模式的最终方案请用 plan_submit 提交，不要用本工具提交方案。',
      approval: 'never',
      inputSchema: ASK_USER_QUESTION_SCHEMA,
    },
    {
      name: 'plan_submit',
      description:
        '提交一份结构化执行方案（规划模式专用）。完成只读调研后调用本工具提交方案：title 标题、goal 目标、scope 范围、assumptions 假设、decisions 已做决策、steps 步骤（每步 title/description/acceptanceChecks 验收标准、可选 expectedFiles）、risks 风险（description/mitigation）、finalAcceptanceChecks 总验收标准。提交成功后方案会显示给用户审批，简要总结要点并停止——不要继续执行任何改动。',
      approval: 'never',
      inputSchema: PLAN_SUBMIT_SCHEMA,
    },
    {
      name: 'task_schedule',
      description:
        'Manage scheduled tasks (定时任务). Actions: "create" (name, instruction, target {kind:"agent",agentId} or {kind:"model",modelId}, rule {kind:"at",runAt} | {kind:"every",intervalMinutes≥5,firstRunAt?} | {kind:"random",windowStart,windowEnd,minTimes,maxTimes} | {kind:"cron",expression}, timeZone?) creates a task that fires by injecting the instruction into its own conversation; "list" returns all tasks; "cancel" (taskId) disables a task. Creating or cancelling requires approval outside full-access mode.',
      approval: 'never',
      planningDenied: true,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'cancel'] },
          name: { type: 'string', description: 'Task name (create).' },
          instruction: {
            type: 'string',
            description: 'Instruction injected to the task conversation when it fires (create).',
          },
          target: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['agent', 'model'] },
              agentId: { type: 'string' },
              modelId: { type: 'string' },
            },
          },
          rule: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['at', 'every', 'random', 'cron'] },
              runAt: { type: 'string' },
              intervalMinutes: { type: 'number' },
              firstRunAt: { type: 'string' },
              windowStart: { type: 'string' },
              windowEnd: { type: 'string' },
              minTimes: { type: 'number' },
              maxTimes: { type: 'number' },
              expression: { type: 'string' },
            },
          },
          timeZone: { type: 'string', description: 'IANA time zone, default UTC.' },
          taskId: { type: 'string', description: 'Task id to cancel.' },
        },
      },
    },
    {
      name: 'goal_manage',
      description:
        'Manage the active goal (目标模式). Actions: "complete" (mark the objective achieved with evidence you gathered), "block" (reason — stop and wait for the user when an unresolvable obstacle blocks progress), "progress" (note — record a short progress note). Only usable while a goal is active in this conversation.',
      approval: 'never',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['complete', 'block', 'progress'] },
          reason: { type: 'string', description: 'Block reason or progress note (≤500 chars).' },
        },
      },
    },
  ],
};
