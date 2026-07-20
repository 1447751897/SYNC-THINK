import type { CommandType } from './commands.js';
import type { CommandCallerSurface } from './framing.js';

export type ApplicationToolConfirmation = 'none' | 'configuration';
export type ApplicationToolOutputSensitivity = 'standard' | 'metadata-only';

export interface ApplicationToolDefinition {
  name: `sync_think.${string}`;
  command: CommandType;
  description: string;
  confirmation: ApplicationToolConfirmation;
  outputSensitivity: ApplicationToolOutputSensitivity;
  inputSchema: ApplicationToolInputSchema;
}

export interface ApplicationToolInputSchema {
  [key: string]: unknown;
  type: 'object';
  additionalProperties: false;
  required?: string[];
  properties: Record<string, Record<string, unknown>>;
}

const string = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const integer = (minimum = 0, maximum?: number) => ({
  type: 'integer',
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
});
const boolean = () => ({ type: 'boolean' });
const strings = (maxItems = 128) => ({ type: 'array', items: { type: 'string' }, maxItems });
const object = () => ({ type: 'object' });
const members = () => ({
  type: 'array',
  minItems: 1,
  maxItems: 64,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['agentVersionId', 'responsibility'],
    properties: { agentVersionId: string(), responsibility: string() },
  },
});
const schema = (
  properties: ApplicationToolInputSchema['properties'],
  required: string[] = [],
): ApplicationToolInputSchema => ({
  type: 'object',
  additionalProperties: false,
  ...(required.length > 0 ? { required } : {}),
  properties,
});

export interface ConfigurationCommandPreview {
  status: 'confirmation_required';
  command: CommandType;
  callerSurface: Exclude<CommandCallerSurface, 'desktop'>;
  confirmationToken: string;
  payloadDigest: string;
  payloadKeys: string[];
  summary: string;
  expiresAt: string;
  auditEventId?: string;
}

export const APPLICATION_TOOL_DEFINITIONS: readonly ApplicationToolDefinition[] = [
  {
    name: 'sync_think.project.list',
    command: 'workspace.list',
    description: 'List SYNC-THINK projects without reading project files.',
    confirmation: 'none',
    outputSensitivity: 'metadata-only',
    inputSchema: schema({}),
  },
  {
    name: 'sync_think.project.create',
    command: 'workspace.create',
    description: 'Create an unbound SYNC-THINK project.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema({ name: string('Project name') }, ['name']),
  },
  {
    name: 'sync_think.task.list',
    command: 'task.list',
    description: 'List tasks in one project.',
    confirmation: 'none',
    outputSensitivity: 'metadata-only',
    inputSchema: schema({ workspaceId: string(), includeArchived: boolean() }, ['workspaceId']),
  },
  {
    name: 'sync_think.task.create',
    command: 'task.create',
    description: 'Create a new task and conversation in one project.',
    confirmation: 'none',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        workspaceId: string(),
        title: string(),
        goal: string(),
        parentTaskId: string(),
        acceptanceCriteria: strings(64),
      },
      ['workspaceId', 'title', 'goal'],
    ),
  },
  {
    name: 'sync_think.subtask.delegate',
    command: 'task.delegateSubtask',
    description: 'Delegate one automatically executed child task to an exact AgentVersion. Omit dependsOnTaskIds for parallel work; include prerequisite child task ids for serial work.',
    confirmation: 'none',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        workspaceId: string(),
        parentTaskId: string(),
        delegateAgentVersionId: string(),
        title: string(),
        goal: string(),
        requiredEvidence: strings(64),
        acceptanceConditions: strings(64),
        allowedTools: strings(64),
        dependsOnTaskIds: strings(64),
      },
      ['workspaceId', 'parentTaskId', 'delegateAgentVersionId', 'title', 'goal'],
    ),
  },
  {
    name: 'sync_think.handoff.record',
    command: 'task.recordHandoff',
    description: 'Record one explicit Agent-to-Agent handoff in the current task event stream.',
    confirmation: 'none',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        taskId: string(),
        fromAgentVersionId: string(),
        toAgentVersionId: string(),
        summary: string(),
        evidenceRefs: strings(64),
        status: { type: 'string', enum: ['completed', 'blocked', 'needs-review'] },
      },
      ['taskId', 'fromAgentVersionId', 'toAgentVersionId', 'summary'],
    ),
  },
  {
    name: 'sync_think.task.open',
    command: 'task.open',
    description: 'Open and inspect one task.',
    confirmation: 'none',
    outputSensitivity: 'standard',
    inputSchema: schema({ taskId: string() }, ['taskId']),
  },
  {
    name: 'sync_think.agent.list',
    command: 'agent.list',
    description: 'List configured Agent versions and model bindings.',
    confirmation: 'none',
    outputSensitivity: 'metadata-only',
    inputSchema: schema({}),
  },
  {
    name: 'sync_think.agent.create',
    command: 'agent.create',
    description: 'Create a versioned Agent definition after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        agentId: string(),
        name: string(),
        description: string(),
        visualIdentity: object(),
        role: string(),
        developerInstructions: string(),
        inputContract: string(),
        outputContract: string(),
        maxConcurrency: integer(1, 16),
        defaultModelId: string(),
        defaultCredentialGroupId: string(),
        pinnedCredentialRefId: string(),
        pauseOnFailure: boolean(),
        fallbackModelIds: strings(32),
        memoryScope: { type: 'string', enum: ['task', 'project', 'global'] },
        skillVersionIds: strings(128),
        mcpServerIds: strings(128),
        mcpToolAllowlist: strings(256),
        permissions: object(),
        policyId: string(),
        approvalMode: { type: 'string', enum: ['request', 'delegate', 'full', 'custom'] },
        reviewBehavior: object(),
        artifactRules: object(),
      },
      ['name', 'role', 'developerInstructions', 'inputContract', 'outputContract', 'defaultModelId'],
    ),
  },
  {
    name: 'sync_think.agent.update',
    command: 'agent.createVersion',
    description: 'Create the next immutable version of an Agent after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        agentId: string(),
        expectedVersion: integer(),
        name: string(),
        description: string(),
        visualIdentity: object(),
        role: string(),
        developerInstructions: string(),
        inputContract: string(),
        outputContract: string(),
        maxConcurrency: integer(1, 16),
        defaultModelId: string(),
        defaultCredentialGroupId: string(),
        pinnedCredentialRefId: { type: ['string', 'null'] },
        pauseOnFailure: boolean(),
        fallbackModelIds: strings(32),
        memoryScope: { type: 'string', enum: ['task', 'project', 'global'] },
        skillVersionIds: strings(128),
        mcpServerIds: strings(128),
        mcpToolAllowlist: strings(256),
        permissions: object(),
        policyId: { type: ['string', 'null'] },
        approvalMode: { type: 'string', enum: ['request', 'delegate', 'full', 'custom'] },
        reviewBehavior: object(),
        artifactRules: object(),
      },
      [
        'agentId',
        'expectedVersion',
        'name',
        'role',
        'developerInstructions',
        'inputContract',
        'outputContract',
        'maxConcurrency',
        'defaultModelId',
        'pauseOnFailure',
        'fallbackModelIds',
        'memoryScope',
        'skillVersionIds',
        'mcpServerIds',
        'approvalMode',
      ],
    ),
  },
  {
    name: 'sync_think.group.list',
    command: 'group.list',
    description: 'List persistent and temporary Agent groups.',
    confirmation: 'none',
    outputSensitivity: 'metadata-only',
    inputSchema: schema({
      kind: { type: 'string', enum: ['fixed', 'temporary'] },
      limit: integer(1, 200),
    }),
  },
  {
    name: 'sync_think.group.get',
    command: 'group.get',
    description: 'Inspect one Agent group and member responsibilities.',
    confirmation: 'none',
    outputSensitivity: 'standard',
    inputSchema: schema({ groupId: string() }, ['groupId']),
  },
  {
    name: 'sync_think.group.create',
    command: 'group.create',
    description: 'Create an Agent group after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        name: string(),
        description: string(),
        kind: { type: 'string', enum: ['fixed', 'temporary'] },
        visualIdentity: object(),
        leadAgentVersionId: string(),
        approvalMode: { type: 'string', enum: ['request', 'delegate', 'full', 'custom'] },
        collaborationMode: { type: 'string', enum: ['parallel', 'sequential'] },
        maxConcurrency: integer(1, 16),
        members: members(),
      },
      ['name', 'kind', 'leadAgentVersionId', 'members'],
    ),
  },
  {
    name: 'sync_think.group.update',
    command: 'group.update',
    description: 'Update an Agent group after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        groupId: string(),
        expectedVersion: integer(1),
        name: string(),
        description: string(),
        kind: { type: 'string', enum: ['fixed', 'temporary'] },
        visualIdentity: object(),
        leadAgentVersionId: string(),
        approvalMode: { type: 'string', enum: ['request', 'delegate', 'full', 'custom'] },
        collaborationMode: { type: 'string', enum: ['parallel', 'sequential'] },
        maxConcurrency: integer(1, 16),
        members: members(),
      },
      ['groupId', 'expectedVersion'],
    ),
  },
  {
    name: 'sync_think.group.member.add',
    command: 'group.member.add',
    description: 'Add a group member after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      { groupId: string(), expectedVersion: integer(1), member: object() },
      ['groupId', 'expectedVersion', 'member'],
    ),
  },
  {
    name: 'sync_think.group.member.remove',
    command: 'group.member.remove',
    description: 'Remove a group member after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      { groupId: string(), expectedVersion: integer(1), agentVersionId: string() },
      ['groupId', 'expectedVersion', 'agentVersionId'],
    ),
  },
  {
    name: 'sync_think.group.member.update_responsibility',
    command: 'group.member.updateResponsibility',
    description: 'Change one group member responsibility after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        groupId: string(),
        expectedVersion: integer(1),
        agentVersionId: string(),
        responsibility: string(),
      },
      ['groupId', 'expectedVersion', 'agentVersionId', 'responsibility'],
    ),
  },
  {
    name: 'sync_think.group.set_lead',
    command: 'group.setLead',
    description: 'Select the single lead Agent for a group after user confirmation.',
    confirmation: 'configuration',
    outputSensitivity: 'standard',
    inputSchema: schema(
      { groupId: string(), expectedVersion: integer(1), agentVersionId: string() },
      ['groupId', 'expectedVersion', 'agentVersionId'],
    ),
  },
  {
    name: 'sync_think.group.task.create',
    command: 'group.task.create',
    description: 'Create a new task bound to a configured Agent group.',
    confirmation: 'none',
    outputSensitivity: 'standard',
    inputSchema: schema(
      {
        groupId: string(),
        workspaceId: string(),
        title: string(),
        goal: string(),
        parentTaskId: string(),
        acceptanceCriteria: strings(64),
      },
      ['groupId', 'workspaceId', 'title', 'goal'],
    ),
  },
  {
    name: 'sync_think.provider.list',
    command: 'provider.list',
    description: 'List provider, credential-group and model metadata without secret values.',
    confirmation: 'none',
    outputSensitivity: 'metadata-only',
    inputSchema: schema({}),
  },
  {
    name: 'sync_think.context.inspect',
    command: 'context.packet.peek',
    description: 'Inspect effective task context and permission metadata without secret material.',
    confirmation: 'none',
    outputSensitivity: 'standard',
    inputSchema: schema({ threadId: string(), userText: string() }, ['threadId', 'userText']),
  },
] as const;

const APPLICATION_TOOL_BY_NAME = new Map(
  APPLICATION_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

const APPLICATION_TOOL_BY_COMMAND = new Map(
  APPLICATION_TOOL_DEFINITIONS.map((definition) => [definition.command, definition]),
);

const CONFIGURATION_COMMANDS = new Set<CommandType>([
  'workspace.create',
  'workspace.bindFolder',
  'provider.create',
  'provider.update',
  'provider.addModels',
  'provider.confirmCapabilities',
  'provider.importCcSwitch',
  'agent.updateBinding',
  'agent.create',
  'agent.createVersion',
  'group.create',
  'group.update',
  'group.member.add',
  'group.member.remove',
  'group.member.updateResponsibility',
  'group.setLead',
  'skill.import',
  'mcp.register',
  'policy.save',
  'automation.create',
  'automation.update',
  'automation.delete',
]);

export function getApplicationToolDefinition(name: string): ApplicationToolDefinition | undefined {
  return APPLICATION_TOOL_BY_NAME.get(name as ApplicationToolDefinition['name']);
}

export function commandRequiresConfigurationConfirmation(command: string): command is CommandType {
  return CONFIGURATION_COMMANDS.has(command as CommandType);
}

export function configurationCommandSummary(command: CommandType): string {
  return (
    APPLICATION_TOOL_BY_COMMAND.get(command)?.description ??
    `Review the SYNC-THINK configuration change for ${command}.`
  );
}
