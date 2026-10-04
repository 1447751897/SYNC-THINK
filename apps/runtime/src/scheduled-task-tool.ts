export const TASK_SCHEDULE_TOOL_DESCRIPTION =
  'Manage scheduled tasks (定时任务). Actions: resources (available models, agents, teams, workspaces, conversations and current defaults), list, get (taskId), create, update (taskId + patch), cancel (taskId). ' +
  'Before creating, call resources and ask the user to confirm the instruction, executor/model, workspace (null for a global task), conversation strategy (task: one dedicated conversation; new: a fresh conversation on every run; existing: a chosen matching conversation), schedule/timezone and enabled state. Use ask_user_question for missing choices; show recommended defaults explicitly, never silently inherit the current model or workspace. ' +
  'Create requires name, instruction, target, rule, an explicit workspaceId and automation.conversation in private chat. Creating with enabled:false saves a draft. ' +
  'To edit, get the exact task first, then update only requested patch fields IN PLACE, preserving the task id, next run, execution history and unmodified bindings. Never cancel/recreate to change the instruction, model, workspace, rule or conversation strategy. ' +
  'Inside a group, operations stay bound to that group queue/workspace; do not move its task to another conversation. Ask mode confirms create/update/cancel. Weekly weekdays are Monday=1 to Sunday=7; inclusive ranges may wrap. Return the saved configuration and task id for further edits.';

const target = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: { kind: { type: 'string', enum: ['agent', 'model', 'team'] }, agentId: { type: 'string' }, modelId: { type: 'string' }, teamId: { type: 'string' } },
};
const rule = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: {
    kind: { type: 'string', enum: ['at', 'every', 'weekly', 'random', 'cron'] },
    runAt: { type: 'string' }, intervalMinutes: { type: 'integer', minimum: 5 }, firstRunAt: { type: 'string' },
    windowStart: { type: 'string' }, windowEnd: { type: 'string' }, minTimes: { type: 'integer', minimum: 1 }, maxTimes: { type: 'integer', minimum: 1 }, atLeastOnce: { type: 'boolean' },
    expression: { type: 'string' }, time: { type: 'string', description: 'HH:mm in the task timezone.' }, startDate: { type: 'string', description: 'YYYY-MM-DD in the task timezone.' },
    selection: { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { type: 'string', enum: ['days', 'range'] }, days: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 }, minItems: 1, maxItems: 7 }, start: { type: 'integer', minimum: 1, maximum: 7 }, end: { type: 'integer', minimum: 1, maximum: 7 } } },
  },
};
const automation = {
  type: ['object', 'null'], description: 'Structured execution settings. update merges supplied settings with the existing binding; null clears it.',
  additionalProperties: false,
  properties: {
    executionMode: { type: 'string', enum: ['ask', 'workspace', 'full-access'] },
    conversation: { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { type: 'string', enum: ['task', 'new', 'existing'] }, conversationId: { type: 'string' } } },
    browser: { type: 'object', additionalProperties: false, required: ['profileId'], properties: { profileId: { type: 'string' }, workflowTaskId: { type: 'string' }, variables: { type: 'object', additionalProperties: { type: 'string' } } } },
    requiredMcpServerIds: { type: 'array', items: { type: 'string' } }, outputs: { type: 'array', items: { type: 'string', enum: ['spreadsheet', 'presentation'] } },
    delivery: { type: 'object', additionalProperties: false, required: ['kind', 'mcpServerId', 'recipient'], properties: { kind: { const: 'gmail' }, mcpServerId: { type: 'string' }, recipient: { type: 'string' }, toolName: { type: 'string' } } },
    acceptance: { type: 'string' }, acceptanceChecks: { type: 'object', description: 'Host-validated artifact acceptance checks.' },
  },
};
const fields = {
  name: { type: 'string', description: 'Task display name.' }, instruction: { type: 'string', description: 'Editable instruction injected at each run.' }, target, rule,
  timeZone: { type: 'string', description: 'IANA timezone. Confirm the resource default with the user.' }, enabled: { type: 'boolean', description: 'false saves a draft; true enables execution.' },
  workspaceId: { type: ['string', 'null'], description: 'Explicit workspace id from resources; null means global/projectless, never a folder path.' },
  skillVersionIds: { type: ['array', 'null'], items: { type: 'string' } }, automation,
};
export const TASK_SCHEDULE_TOOL_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['action'],
  properties: {
    action: { type: 'string', enum: ['resources', 'create', 'list', 'get', 'update', 'cancel'] },
    taskId: { type: 'string', description: 'Existing task id for get/update/cancel.' },
    ...fields,
    patch: { type: 'object', additionalProperties: false, minProperties: 1, properties: fields, description: 'Only the fields the user wants changed. Existing task id and history are preserved.' },
  },
};

/** Missing choices are surfaced before any task is saved; group queues own their destination. */
export function missingScheduledTaskConfiguration(input: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!Object.hasOwn(input, 'workspaceId') || (input.workspaceId !== null && (typeof input.workspaceId !== 'string' || !input.workspaceId.trim()))) missing.push('workspaceId');
  const binding = input.automation;
  const conversation = binding && typeof binding === 'object' ? (binding as Record<string, unknown>).conversation : undefined;
  if (!conversation || typeof conversation !== 'object' || !['task', 'new', 'existing'].includes(String((conversation as Record<string, unknown>).mode))) missing.push('automation.conversation');
  return missing;
}
