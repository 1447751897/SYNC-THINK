import { describe, expect, it } from 'vitest';
import { validateAutomationReadiness } from './readiness.js';
import type { AutomationReadinessDependencies, AutomationTaskInput } from './types.js';

function task(): AutomationTaskInput {
  return {
    id: 'scheduled-1',
    name: 'Collect evidence',
    instruction: 'Complete the requested analysis.',
    target: { kind: 'model', modelId: 'model-1' },
    workspaceId: 'workspace-1',
  };
}
function dependencies(): AutomationReadinessDependencies {
  return {
    firedAt: '2026-10-02T01:00:00.000Z',
    runId: 'run-1',
    defaultWorkspaceId: 'workspace-1',
    workspaces: [{ id: 'workspace-1', available: true }],
    models: [{ id: 'model-1', available: true }],
    agents: [
      { id: 'agent-1', available: true, modelId: 'model-1' },
      { id: 'agent-2', available: true, modelId: 'model-1' },
    ],
    teams: [
      {
        id: 'team-1',
        available: true,
        memberAgentIds: ['agent-1', 'agent-2'],
        coordinatorAgentId: 'agent-1',
      },
    ],
    browserAvailable: true,
    browserWorkflowReplayAvailable: true,
    browserProfiles: [{ id: 'profile-1', available: true }],
    browserWorkflows: [
      {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        profileId: 'profile-1',
        enabled: true,
        publishedVersionId: 'version-1',
        publishedVersion: { id: 'version-1', requiredVariables: ['query'] },
      },
    ],
  };
}

describe('Automation readiness public boundary', () => {
  it('accepts a usable direct model with no browser or MCP requirement', () => {
    const result = validateAutomationReadiness(task(), dependencies());
    expect(result).toMatchObject({
      status: 'ready',
      ready: true,
      issues: [],
      snapshot: {
        workspaceId: 'workspace-1',
        actors: [{ modelId: 'model-1' }],
        mcpServers: [],
        outputs: [],
      },
    });
    if (result.ready) expect(result.snapshot.browser).toBeUndefined();
  });
});

function expectIssue(
  value: AutomationTaskInput,
  patch: Partial<AutomationReadinessDependencies>,
  code: string,
  status = 'blocked',
): void {
  const result = validateAutomationReadiness(value, { ...dependencies(), ...patch });
  expect(result.status).toBe(status);
  expect(result.ready).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain(code);
  expect('snapshot' in result).toBe(false);
}
const browser = {
  profileId: 'profile-1',
  workflowTaskId: 'workflow-1',
  variables: { query: '本轮查询' },
};
const actorTargets: AutomationTaskInput['target'][] = [
  { kind: 'model', modelId: 'model-1' },
  { kind: 'agent', agentId: 'agent-1' },
  { kind: 'team', teamId: 'team-1' },
];

describe('Actor × browser readiness matrix', () => {
  it.each(
    actorTargets.flatMap((target) => [false, true].map((withBrowser) => ({ target, withBrowser }))),
  )('$target.kind / browser=$withBrowser', ({ target, withBrowser }) => {
    const result = validateAutomationReadiness(
      { ...task(), target, ...(withBrowser ? { automation: { browser } } : {}) },
      dependencies(),
    );
    expect(result.status).toBe('ready');
    if (!result.ready) throw new Error(JSON.stringify(result.issues));
    expect(result.snapshot.target).toEqual(target);
    expect(result.snapshot.actors).toHaveLength(target.kind === 'team' ? 2 : 1);
    expect(result.snapshot.browser?.workflowVersionId).toBe(withBrowser ? 'version-1' : undefined);
  });
  it('does not force browser dependencies on non-browser tasks', () => {
    expect(
      validateAutomationReadiness(task(), {
        ...dependencies(),
        browserAvailable: false,
        browserProfiles: [],
        browserWorkflows: [],
      }).ready,
    ).toBe(true);
  });
  it('rejects a missing model', () => expectIssue(task(), { models: [] }, 'MODEL_MISSING'));
  it('rejects an unavailable model with its concrete reason', () => {
    const result = validateAutomationReadiness(task(), {
      ...dependencies(),
      models: [{ id: 'model-1', available: false, reason: 'credential expired' }],
    });
    expect(result.issues.find((issue) => issue.code === 'MODEL_UNAVAILABLE')?.message).toContain(
      'credential expired',
    );
  });
  it('rejects a missing agent', () =>
    expectIssue({ ...task(), target: actorTargets[1]! }, { agents: [] }, 'AGENT_MISSING'));
  it('rejects a disabled or archived agent', () =>
    expectIssue(
      { ...task(), target: actorTargets[1]! },
      { agents: [{ id: 'agent-1', available: false, modelId: 'model-1' }] },
      'AGENT_UNAVAILABLE',
    ));
  it('rejects an agent whose configured model is unavailable', () =>
    expectIssue(
      { ...task(), target: actorTargets[1]! },
      { models: [] },
      'AGENT_MODEL_UNAVAILABLE',
    ));
  it('selects only a live, configured fallback model', () => {
    const result = validateAutomationReadiness(
      { ...task(), target: actorTargets[1]! },
      {
        ...dependencies(),
        models: [{ id: 'fallback-1', available: true }],
        agents: [
          { id: 'agent-1', available: true, modelId: 'missing', fallbackModelIds: ['fallback-1'] },
        ],
      },
    );
    expect(result).toMatchObject({
      ready: true,
      snapshot: { actors: [{ agentId: 'agent-1', modelId: 'fallback-1' }] },
    });
  });
  it('rejects a missing team', () =>
    expectIssue({ ...task(), target: actorTargets[2]! }, { teams: [] }, 'TEAM_MISSING'));
  it('rejects an unavailable team', () =>
    expectIssue(
      { ...task(), target: actorTargets[2]! },
      { teams: [{ ...dependencies().teams[0]!, available: false }] },
      'TEAM_UNAVAILABLE',
    ));
  it('rejects an empty team', () =>
    expectIssue(
      { ...task(), target: actorTargets[2]! },
      { teams: [{ ...dependencies().teams[0]!, memberAgentIds: [] }] },
      'TEAM_EMPTY',
    ));
  it('rejects a team with no coordinator', () =>
    expectIssue(
      { ...task(), target: actorTargets[2]! },
      { teams: [{ ...dependencies().teams[0]!, coordinatorAgentId: undefined }] },
      'TEAM_COORDINATOR_MISSING',
    ));
  it('rejects a coordinator outside the team roster', () =>
    expectIssue(
      { ...task(), target: actorTargets[2]! },
      { teams: [{ ...dependencies().teams[0]!, coordinatorAgentId: 'outsider' }] },
      'TEAM_COORDINATOR_NOT_MEMBER',
    ));
  it('validates every team member, not just the coordinator', () =>
    expectIssue(
      { ...task(), target: actorTargets[2]! },
      { agents: [dependencies().agents[0]!] },
      'AGENT_MISSING',
    ));
  it('validates the coordinator model', () =>
    expectIssue(
      { ...task(), target: actorTargets[2]! },
      { agents: [{ ...dependencies().agents[0]!, modelId: 'dead' }, dependencies().agents[1]!] },
      'AGENT_MODEL_UNAVAILABLE',
    ));
  it('resolves an omitted workspace through the explicit inbox/default workspace', () => {
    expect(
      validateAutomationReadiness({ ...task(), workspaceId: undefined }, dependencies()),
    ).toMatchObject({ ready: true, snapshot: { workspaceId: 'workspace-1' } });
  });
  it('rejects a deleted workspace', () =>
    expectIssue(task(), { workspaces: [] }, 'WORKSPACE_MISSING'));
  it('rejects an unavailable workspace', () =>
    expectIssue(
      task(),
      { workspaces: [{ id: 'workspace-1', available: false }] },
      'WORKSPACE_UNAVAILABLE',
    ));
  it('rejects an invalid triggering time', () =>
    expectIssue(task(), { firedAt: 'not-a-date' }, 'RUN_TIME_INVALID'));
});

describe('Bound Browserflow preflight', () => {
  const browserTask = (): AutomationTaskInput => ({ ...task(), automation: { browser } });
  it('requires a live browser capability only for browser tasks', () =>
    expectIssue(browserTask(), { browserAvailable: false }, 'BROWSER_UNAVAILABLE'));
  it('rejects a deleted Profile', () =>
    expectIssue(browserTask(), { browserProfiles: [] }, 'BROWSER_PROFILE_MISSING'));
  it('rejects an unavailable Profile', () =>
    expectIssue(
      browserTask(),
      { browserProfiles: [{ id: 'profile-1', available: false }] },
      'BROWSER_PROFILE_UNAVAILABLE',
    ));
  it('allows Profile-only use without forcing a workflow replay capability', () => {
    const result = validateAutomationReadiness(
      { ...task(), automation: { browser: { profileId: 'profile-1' } } },
      { ...dependencies(), browserWorkflowReplayAvailable: false, browserWorkflows: [] },
    );
    expect(result.ready).toBe(true);
  });
  it('rejects a deleted workflow', () =>
    expectIssue(browserTask(), { browserWorkflows: [] }, 'BROWSER_WORKFLOW_MISSING'));
  it('rejects an unpublished workflow', () =>
    expectIssue(
      browserTask(),
      {
        browserWorkflows: [
          { ...dependencies().browserWorkflows![0]!, publishedVersionId: undefined },
        ],
      },
      'BROWSER_WORKFLOW_UNPUBLISHED',
    ));
  it('rejects a missing published version record', () =>
    expectIssue(
      browserTask(),
      {
        browserWorkflows: [
          { ...dependencies().browserWorkflows![0]!, publishedVersion: undefined },
        ],
      },
      'BROWSER_WORKFLOW_UNPUBLISHED',
    ));
  it('rejects a mismatched published version record', () =>
    expectIssue(
      browserTask(),
      {
        browserWorkflows: [
          {
            ...dependencies().browserWorkflows![0]!,
            publishedVersion: { id: 'old-version', requiredVariables: [] },
          },
        ],
      },
      'BROWSER_WORKFLOW_UNPUBLISHED',
    ));
  it('rejects a disabled workflow', () =>
    expectIssue(
      browserTask(),
      { browserWorkflows: [{ ...dependencies().browserWorkflows![0]!, enabled: false }] },
      'BROWSER_WORKFLOW_DISABLED',
    ));
  it('rejects a workflow from another workspace', () =>
    expectIssue(
      browserTask(),
      { browserWorkflows: [{ ...dependencies().browserWorkflows![0]!, workspaceId: 'other' }] },
      'BROWSER_WORKFLOW_WORKSPACE_MISMATCH',
    ));
  it.each(['workspace-1', 'workspace-2'])(
    'allows a global Browserflow in selected %s',
    (workspaceId) => {
      const result = validateAutomationReadiness(
        { ...browserTask(), workspaceId },
        {
          ...dependencies(),
          workspaces: [{ id: workspaceId, available: true }],
          browserWorkflows: [{ ...dependencies().browserWorkflows![0]!, workspaceId: undefined }],
        },
      );
      expect(result).toMatchObject({
        ready: true,
        snapshot: { workspaceId, browser: { workflowVersionId: 'version-1' } },
      });
    },
  );
  it('rejects a workflow from another Profile', () =>
    expectIssue(
      browserTask(),
      { browserWorkflows: [{ ...dependencies().browserWorkflows![0]!, profileId: 'other' }] },
      'BROWSER_WORKFLOW_PROFILE_MISMATCH',
    ));
  it('rejects a missing replay capability', () =>
    expectIssue(
      browserTask(),
      { browserWorkflowReplayAvailable: false },
      'BROWSER_WORKFLOW_REPLAY_UNAVAILABLE',
    ));
  it.each<Readonly<Record<string, string>> | undefined>([
    undefined,
    {},
    { query: '' },
    { query: '  ' },
  ])('rejects missing or empty required values %j', (variables) => {
    expectIssue(
      { ...task(), automation: { browser: { ...browser, variables } } },
      {},
      'BROWSER_VARIABLE_MISSING',
    );
  });
  it('accepts a string zero as a real variable value', () => {
    expect(
      validateAutomationReadiness(
        { ...task(), automation: { browser: { ...browser, variables: { query: '0' } } } },
        dependencies(),
      ).ready,
    ).toBe(true);
  });
  it('yields on known login requirements with a stable identity', () => {
    const deps = {
      ...dependencies(),
      browserProfiles: [{ id: 'profile-1', available: true, loginState: 'required' as const }],
    };
    const first = validateAutomationReadiness(browserTask(), deps);
    const second = validateAutomationReadiness(browserTask(), {
      ...deps,
      firedAt: '2026-10-02T02:00:00.000Z',
    });
    expect(first.status).toBe('waiting_input');
    expect(first.issues[0]?.code).toBe('LOGIN_REQUIRED');
    expect(first.issues[0]?.dedupeKey).toBe(second.issues[0]?.dedupeKey);
  });
  it('yields on pending Profile approval', () =>
    expectIssue(
      browserTask(),
      { browserProfiles: [{ id: 'profile-1', available: true, approvalState: 'pending' }] },
      'APPROVAL_REQUIRED',
      'waiting_input',
    ));
  it('yields on workflow approval configuration', () =>
    expectIssue(
      browserTask(),
      {
        browserWorkflows: [{ ...dependencies().browserWorkflows![0]!, approvalState: 'required' }],
      },
      'APPROVAL_REQUIRED',
      'waiting_input',
    ));
  it('retains an existing handoff identity and does not call or generate requests', () => {
    const result = validateAutomationReadiness(browserTask(), {
      ...dependencies(),
      pendingInputs: [
        {
          kind: 'login',
          key: 'handoff-existing',
          taskId: 'scheduled-1',
          profileId: 'profile-1',
          reason: 'Login pending',
        },
      ],
    });
    expect(result).toMatchObject({
      status: 'waiting_input',
      issues: [{ code: 'LOGIN_REQUIRED', dedupeKey: 'handoff-existing' }],
    });
  });
  it('ignores pending input belonging to another task or Profile', () => {
    const result = validateAutomationReadiness(browserTask(), {
      ...dependencies(),
      pendingInputs: [
        { kind: 'login', key: 'other', taskId: 'scheduled-other', reason: 'Login pending' },
        { kind: 'approval', key: 'other-profile', profileId: 'other', reason: 'Approval pending' },
      ],
    });
    expect(result.ready).toBe(true);
  });
  it('lets configuration errors dominate waiting states without hiding either issue', () => {
    const result = validateAutomationReadiness(browserTask(), {
      ...dependencies(),
      models: [],
      browserProfiles: [{ id: 'profile-1', available: true, loginState: 'required' }],
    });
    expect(result.status).toBe('blocked');
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['MODEL_MISSING', 'LOGIN_REQUIRED']),
    );
  });
});

describe('MCP, output and Gmail capability chain', () => {
  const server = () => ({
    id: 'gmail-1',
    registered: true,
    connected: true,
    connector: 'gmail' as const,
    tools: [{ name: 'gmail_send_message', available: true, capabilities: ['gmail.send' as const] }],
  });
  const mcpTask = (): AutomationTaskInput => ({
    ...task(),
    automation: { requiredMcpServerIds: ['gmail-1'] },
  });
  const mailTask = (): AutomationTaskInput => ({
    ...task(),
    automation: {
      delivery: { kind: 'gmail', mcpServerId: 'gmail-1', recipient: 'person@example.com' },
    },
  });
  it('accepts a registered connected MCP with at least one accessible tool', () => {
    const result = validateAutomationReadiness(mcpTask(), {
      ...dependencies(),
      mcpServers: [server()],
    });
    expect(result).toMatchObject({
      ready: true,
      snapshot: {
        mcpServers: [
          { id: 'gmail-1', tools: [{ name: 'gmail_send_message', mcpServerId: 'gmail-1' }] },
        ],
      },
    });
  });
  it('rejects required MCP when no MCP is configured', () =>
    expectIssue(mcpTask(), {}, 'MCP_UNREGISTERED'));
  it('rejects unregistered MCP even if its fixture says connected', () =>
    expectIssue(
      mcpTask(),
      { mcpServers: [{ ...server(), registered: false }] },
      'MCP_UNREGISTERED',
    ));
  it('rejects disconnected MCP even if stale tools exist', () =>
    expectIssue(
      mcpTask(),
      { mcpServers: [{ ...server(), connected: false }] },
      'MCP_DISCONNECTED',
    ));
  it('rejects connected MCP without any tool', () =>
    expectIssue(mcpTask(), { mcpServers: [{ ...server(), tools: [] }] }, 'MCP_TOOLS_MISSING'));
  it('rejects MCP tools hidden from the actual executor', () =>
    expectIssue(
      mcpTask(),
      { mcpServers: [{ ...server(), tools: [{ name: 'read', available: false }] }] },
      'MCP_TOOLS_MISSING',
    ));
  it('rejects actor-inaccessible MCP', () =>
    expectIssue(mcpTask(), { mcpServers: [{ ...server(), available: false }] }, 'MCP_UNAVAILABLE'));
  it('does not require unrelated MCP servers to connect', () => {
    expect(
      validateAutomationReadiness(task(), {
        ...dependencies(),
        mcpServers: [{ ...server(), connected: false }],
      }).ready,
    ).toBe(true);
  });
  it('freezes required server IDs only once', () => {
    const result = validateAutomationReadiness(
      { ...task(), automation: { requiredMcpServerIds: ['gmail-1', 'gmail-1'] } },
      { ...dependencies(), mcpServers: [server()] },
    );
    if (!result.ready) throw new Error('Expected ready');
    expect(result.snapshot.mcpServers).toHaveLength(1);
  });
  it('accepts Gmail and implicitly includes its explicitly specified server', () => {
    const result = validateAutomationReadiness(mailTask(), {
      ...dependencies(),
      mcpServers: [server()],
    });
    expect(result).toMatchObject({
      ready: true,
      snapshot: {
        mcpServers: [{ id: 'gmail-1' }],
        delivery: {
          mcpServerId: 'gmail-1',
          recipient: 'person@example.com',
          sendToolNames: ['gmail_send_message'],
        },
      },
    });
  });
  it('requires an explicit Gmail server id', () =>
    expectIssue(
      {
        ...task(),
        automation: {
          delivery: { kind: 'gmail', mcpServerId: '', recipient: 'person@example.com' },
        },
      },
      {},
      'GMAIL_SERVER_REQUIRED',
    ));
  it('rejects a generic connector mislabeled by its tool name', () =>
    expectIssue(
      mailTask(),
      { mcpServers: [{ ...server(), connector: 'other' }] },
      'GMAIL_CONNECTOR_REQUIRED',
    ));
  it('requires a real send capability rather than a read-only Gmail connector', () =>
    expectIssue(
      mailTask(),
      { mcpServers: [{ ...server(), tools: [{ name: 'gmail_list_messages', available: true }] }] },
      'GMAIL_SEND_TOOL_MISSING',
    ));
  it('does not guess send semantics from a tool name', () =>
    expectIssue(
      mailTask(),
      { mcpServers: [{ ...server(), tools: [{ name: 'looks_like_send_mail', available: true }] }] },
      'GMAIL_SEND_TOOL_MISSING',
    ));
  it('does not use a send tool from another server', () =>
    expectIssue(
      mailTask(),
      {
        mcpServers: [
          { ...server(), tools: [{ name: 'read', available: true }] },
          { ...server(), id: 'other-gmail' },
        ],
      },
      'GMAIL_SEND_TOOL_MISSING',
    ));
  it('never returns a ready send plan for a disconnected Gmail server', () =>
    expectIssue(
      mailTask(),
      { mcpServers: [{ ...server(), connected: false }] },
      'MCP_DISCONNECTED',
    ));
  it.each([
    '',
    'no-address',
    'person@example.com\nBcc:other@example.com',
    'one@example.com,two@example.com',
  ])('rejects invalid recipient %j', (recipient) => {
    expectIssue(
      { ...task(), automation: { delivery: { kind: 'gmail', mcpServerId: 'gmail-1', recipient } } },
      { mcpServers: [server()] },
      'GMAIL_RECIPIENT_INVALID',
    );
  });
  it.each(['spreadsheet', 'presentation'] as const)(
    'reports missing %s output capability',
    (kind) =>
      expectIssue({ ...task(), automation: { outputs: [kind] } }, {}, 'OUTPUT_CAPABILITY_MISSING'),
  );
  it('accepts explicitly classified local output tools and deduplicates outputs', () => {
    const result = validateAutomationReadiness(
      { ...task(), automation: { outputs: ['spreadsheet', 'presentation', 'spreadsheet'] } },
      {
        ...dependencies(),
        tools: [
          { name: 'write_workbook', available: true, capabilities: ['spreadsheet'] },
          { name: 'write_deck', available: true, capabilities: ['presentation'] },
        ],
      },
    );
    expect(result).toMatchObject({
      ready: true,
      snapshot: {
        outputs: [
          { kind: 'spreadsheet', tools: [{ name: 'write_workbook' }] },
          { kind: 'presentation', tools: [{ name: 'write_deck' }] },
        ],
      },
    });
  });
  it('ignores unavailable output tools', () =>
    expectIssue(
      { ...task(), automation: { outputs: ['spreadsheet'] } },
      { tools: [{ name: 'write_workbook', available: false, capabilities: ['spreadsheet'] }] },
      'OUTPUT_CAPABILITY_MISSING',
    ));
  it('does not silently infer output capability from an arbitrary tool name', () =>
    expectIssue(
      { ...task(), automation: { outputs: ['spreadsheet'] } },
      { tools: [{ name: 'spreadsheet_magic', available: true }] },
      'OUTPUT_CAPABILITY_MISSING',
    ));
  it('accepts output capability from a selected connected MCP', () => {
    const result = validateAutomationReadiness(
      {
        ...mcpTask(),
        automation: { requiredMcpServerIds: ['gmail-1'], outputs: ['presentation'] },
      },
      {
        ...dependencies(),
        mcpServers: [
          {
            ...server(),
            tools: [{ name: 'make_slides', available: true, capabilities: ['presentation'] }],
          },
        ],
      },
    );
    expect(result).toMatchObject({
      ready: true,
      snapshot: {
        outputs: [
          { kind: 'presentation', tools: [{ name: 'make_slides', mcpServerId: 'gmail-1' }] },
        ],
      },
    });
  });
  it('ignores output tools from MCP outside the frozen required server set', () =>
    expectIssue(
      { ...task(), automation: { outputs: ['presentation'] } },
      {
        mcpServers: [
          {
            ...server(),
            tools: [{ name: 'make_slides', available: true, capabilities: ['presentation'] }],
          },
        ],
      },
      'OUTPUT_CAPABILITY_MISSING',
    ));
  it('accepts an approved injected output skill with its real execution tools', () => {
    const result = validateAutomationReadiness(
      { ...task(), skillVersionIds: ['skill-1'], automation: { outputs: ['spreadsheet'] } },
      {
        ...dependencies(),
        tools: [{ name: 'execute_python', available: true }],
        skills: [
          {
            id: 'skill-1',
            available: true,
            outputs: ['spreadsheet'],
            requiredToolNames: ['execute_python'],
          },
        ],
      },
    );
    expect(result).toMatchObject({
      ready: true,
      snapshot: {
        outputs: [{ kind: 'spreadsheet', skillVersionIds: ['skill-1'] }],
        skillVersionIds: ['skill-1'],
      },
    });
  });
  it('rejects a selected disabled or unapproved skill', () =>
    expectIssue(
      { ...task(), skillVersionIds: ['skill-1'] },
      { skills: [{ id: 'skill-1', available: false, outputs: ['spreadsheet'] }] },
      'SKILL_UNAVAILABLE',
    ));
  it('rejects a deleted selected skill', () =>
    expectIssue({ ...task(), skillVersionIds: ['missing'] }, {}, 'SKILL_UNAVAILABLE'));
  it('does not treat an unselected skill as injected capability', () =>
    expectIssue(
      { ...task(), automation: { outputs: ['spreadsheet'] } },
      { skills: [{ id: 'skill-1', available: true, outputs: ['spreadsheet'] }] },
      'OUTPUT_CAPABILITY_MISSING',
    ));
  it('reports the executable tool missing behind an output skill', () =>
    expectIssue(
      { ...task(), skillVersionIds: ['skill-1'], automation: { outputs: ['spreadsheet'] } },
      {
        skills: [
          {
            id: 'skill-1',
            available: true,
            outputs: ['spreadsheet'],
            requiredToolNames: ['execute_python'],
          },
        ],
      },
      'SKILL_TOOL_MISSING',
    ));
  it('freezes copied input values without freezing the caller inventory', () => {
    const variables = { query: 'original' };
    const tools = [
      { name: 'write_workbook', available: true, capabilities: ['spreadsheet' as const] },
    ];
    const result = validateAutomationReadiness(
      { ...task(), automation: { browser: { ...browser, variables }, outputs: ['spreadsheet'] } },
      { ...dependencies(), tools },
    );
    if (!result.ready) throw new Error('Expected ready');
    variables.query = 'edited-after-start';
    tools[0]!.name = 'edited-tool';
    expect(result.snapshot.browser?.variables.query).toBe('original');
    expect(result.snapshot.outputs[0]?.tools[0]?.name).toBe('write_workbook');
    expect(Object.isFrozen(variables)).toBe(false);
    expect(Object.isFrozen(tools)).toBe(false);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.browser?.variables)).toBe(true);
    expect(Object.isFrozen(result.snapshot.outputs[0]?.tools[0]?.capabilities)).toBe(true);
  });
});

describe('Frozen execution policy is not capability availability', () => {
  it('defaults to workspace execution policy', () => {
    expect(validateAutomationReadiness(task(), dependencies())).toMatchObject({
      ready: true,
      snapshot: { executionMode: 'workspace' },
    });
  });
  it.each(['ask', 'workspace', 'full-access'] as const)(
    'freezes %s without modifying readiness rules',
    (executionMode) => {
      expect(
        validateAutomationReadiness({ ...task(), automation: { executionMode } }, dependencies()),
      ).toMatchObject({ ready: true, snapshot: { executionMode } });
    },
  );
  it('full-access still blocks disconnected MCP', () => {
    expectIssue(
      {
        ...task(),
        automation: { executionMode: 'full-access', requiredMcpServerIds: ['server-1'] },
      },
      {
        mcpServers: [
          {
            id: 'server-1',
            registered: true,
            connected: false,
            tools: [{ name: 'read', available: true }],
          },
        ],
      },
      'MCP_DISCONNECTED',
    );
  });
  it('full-access still blocks missing Gmail send capability', () => {
    expectIssue(
      {
        ...task(),
        automation: {
          executionMode: 'full-access',
          delivery: { kind: 'gmail', mcpServerId: 'server-1', recipient: 'person@example.com' },
        },
      },
      {
        mcpServers: [
          {
            id: 'server-1',
            registered: true,
            connected: true,
            connector: 'gmail',
            tools: [{ name: 'read', available: true }],
          },
        ],
      },
      'GMAIL_SEND_TOOL_MISSING',
    );
  });
  it('full-access still blocks unpublished Browserflow', () => {
    expectIssue(
      { ...task(), automation: { executionMode: 'full-access', browser } },
      {
        browserWorkflows: [
          { ...dependencies().browserWorkflows![0]!, publishedVersionId: undefined },
        ],
      },
      'BROWSER_WORKFLOW_UNPUBLISHED',
    );
  });
  it('full-access still yields on a real login handoff', () => {
    expectIssue(
      { ...task(), automation: { executionMode: 'full-access', browser } },
      { browserProfiles: [{ id: 'profile-1', available: true, loginState: 'required' }] },
      'LOGIN_REQUIRED',
      'waiting_input',
    );
  });
});

describe('Admission reason-list convenience', () => {
  it('returns human-readable reasons alongside structured issues', () => {
    const result = validateAutomationReadiness(task(), {
      ...dependencies(),
      models: [],
      workspaces: [],
    });
    expect(result.reasons).toEqual(result.issues.map((issue) => issue.message));
    expect(result.reasons).toHaveLength(2);
    expect(Object.isFrozen(result.reasons)).toBe(true);
  });
  it('returns an empty reason list for ready admissions', () => {
    expect(validateAutomationReadiness(task(), dependencies()).reasons).toEqual([]);
  });
});

describe('Explicit connector send-tool declaration', () => {
  const namedTask = (toolName = 'dispatch_v2'): AutomationTaskInput => ({
    ...task(),
    automation: {
      delivery: {
        kind: 'gmail',
        mcpServerId: 'connector-1',
        toolName,
        recipient: 'person@example.com',
      },
    },
  });
  function namedDeps(): AutomationReadinessDependencies {
    return {
      ...dependencies(),
      mcpServers: [
        {
          id: 'connector-1',
          registered: true,
          connected: true,
          connector: 'gmail',
          tools: [
            { name: 'dispatch_v2', available: true, capabilities: ['gmail.send'] },
            { name: 'another_send', available: true, capabilities: ['gmail.send'] },
          ],
        },
      ],
    };
  }
  it('freezes an opaque declared tool classified by the host, not by its name', () => {
    const result = validateAutomationReadiness(namedTask(), namedDeps());
    expect(result).toMatchObject({
      ready: true,
      snapshot: { delivery: { toolName: 'dispatch_v2', sendToolNames: ['dispatch_v2'] } },
    });
  });
  it('never substitutes another send-capable tool when the declared tool is absent', () => {
    expectIssue(namedTask('not-listed'), namedDeps(), 'GMAIL_SEND_TOOL_MISSING');
  });
  it('requires the declared real tool to carry the verified send capability', () => {
    const deps = namedDeps();
    expectIssue(
      namedTask(),
      {
        ...deps,
        mcpServers: [
          {
            ...deps.mcpServers![0]!,
            tools: [
              { name: 'dispatch_v2', available: true },
              { name: 'another_send', available: true, capabilities: ['gmail.send'] },
            ],
          },
        ],
      },
      'GMAIL_SEND_TOOL_MISSING',
    );
  });
  it('requires the declared tool to be available to the actual actor', () => {
    const deps = namedDeps();
    expectIssue(
      namedTask(),
      {
        ...deps,
        mcpServers: [
          {
            ...deps.mcpServers![0]!,
            tools: [
              { name: 'dispatch_v2', available: false, capabilities: ['gmail.send'] },
              { name: 'another_send', available: true, capabilities: ['gmail.send'] },
            ],
          },
        ],
      },
      'GMAIL_SEND_TOOL_MISSING',
    );
  });
  it('does not match the declared tool against a different connector', () => {
    const deps = namedDeps();
    expectIssue(
      namedTask(),
      {
        ...deps,
        mcpServers: [
          { ...deps.mcpServers![0]!, tools: [{ name: 'read', available: true }] },
          { ...deps.mcpServers![0]!, id: 'other-connector' },
        ],
      },
      'GMAIL_SEND_TOOL_MISSING',
    );
  });
  it.each(['', ' dispatch_v2 ', 'DISPATCH_V2'])(
    'does not silently normalize or replace explicit tool name %j',
    (toolName) => {
      expectIssue(namedTask(toolName), namedDeps(), 'GMAIL_SEND_TOOL_MISSING');
    },
  );
  it('keeps the existing capability-based behavior when toolName is omitted', () => {
    const value = namedTask();
    const result = validateAutomationReadiness(
      {
        ...value,
        automation: { delivery: { ...value.automation!.delivery!, toolName: undefined } },
      },
      namedDeps(),
    );
    expect(result).toMatchObject({
      ready: true,
      snapshot: { delivery: { sendToolNames: ['dispatch_v2', 'another_send'] } },
    });
    if (result.ready) expect(result.snapshot.delivery?.toolName).toBeUndefined();
  });
});
