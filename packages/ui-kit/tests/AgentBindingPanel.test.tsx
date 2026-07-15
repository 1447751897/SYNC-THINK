import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import {
  AgentBindingPanel,
  projectAgentCapabilityReadiness,
} from '../src/components/AgentBindingPanel.js';

afterEach(() => cleanup());

const models = [
  { modelId: 'm1', label: 'GW · mini' },
  { modelId: 'm2', label: 'GW · pro' },
  { modelId: 'm3', label: 'GW · max' },
];

const credentials = [
  {
    credentialRefId: 'cr-a1',
    credentialGroupId: 'cg-a',
    groupName: 'prod-pool',
    label: 'primary',
    providerName: 'Gateway A',
    kind: 'api-key',
  },
  {
    credentialRefId: 'cr-a2',
    credentialGroupId: 'cg-a',
    groupName: 'prod-pool',
    label: 'secondary',
    providerName: 'Gateway A',
    kind: 'api-key',
  },
  {
    credentialRefId: 'cr-b1',
    credentialGroupId: 'cg-b',
    groupName: 'alt',
    label: 'only',
    providerName: 'Gateway B',
    kind: 'api-key',
  },
];

const skills = [
  {
    skillVersionId: 'skv-1',
    name: 'minimal',
    version: '0.1.0',
    description: 'A minimal skill',
    hasScripts: false,
  },
  {
    skillVersionId: 'skv-2',
    name: 'with-scripts',
    version: '0.1.0',
    description: 'scripts recorded only',
    hasScripts: true,
  },
];

const binding = {
  agentId: 'agent-default-conversation',
  agentVersionId: 'av1',
  version: 1,
  name: 'Conversation',
  role: 'generalist',
  defaultModelId: 'm1',
  fallbackModelIds: ['m2'] as string[],
  pauseOnFailure: true,
  defaultCredentialGroupId: 'credential-group-unassigned',
  pinnedCredentialRefId: null as string | null,
  skillVersionIds: [] as string[],
  mcpServerIds: [] as string[],
};

describe('AgentBindingPanel', () => {
  it('renders version meta and saves dirty binding with ordered fallbacks and empty skill allowlist', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        credentials={credentials}
        skills={skills}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId('agent-version-label').textContent).toMatch(/v1/);
    expect(screen.getByTestId('agent-default-model').getAttribute('data-has-value')).toBe('1');
    expect(screen.getByTestId('agent-default-model').getAttribute('data-has-value')).toBe('1');

    // Hierarchical Fallback board: 分组 → 供应商 → 模型
    const fbM3 = screen.getByTestId('agent-fallback-board-model-m3');
    fireEvent.click(fbM3);
    // ModelPathBoard is embedded: select m2 directly (may need surface/group nav)
    const m2 = screen.queryByTestId('agent-default-model-model-m2');
    if (!m2) {
      const groups = screen.queryAllByTestId(/agent-default-model-group-/);
      for (const g of groups) fireEvent.click(g);
    }
    fireEvent.click(screen.getByTestId('agent-default-model-model-m2'));
    fireEvent.click(screen.getByTestId('agent-save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultModelId: 'm2',
          pauseOnFailure: true,
          skillVersionIds: [],
        }),
      );
    });
    const arg = onSave.mock.calls[0]![0] as { fallbackModelIds: string[]; skillVersionIds: string[] };
    expect(arg.fallbackModelIds).toContain('m3');
    expect(arg.fallbackModelIds).not.toContain('m2');
    expect(arg.skillVersionIds).toEqual([]);
  });

  it('saves credential group and optional pin without secrets', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        credentials={credentials}
        skills={skills}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId('agent-credential-block')).toBeTruthy();
    fireEvent.change(screen.getByTestId('agent-credential-group'), { target: { value: 'cg-a' } });
    fireEvent.change(screen.getByTestId('agent-credential-pin'), { target: { value: 'cr-a2' } });
    fireEvent.click(screen.getByTestId('agent-save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultCredentialGroupId: 'cg-a',
          pinnedCredentialRefId: 'cr-a2',
          defaultModelId: 'm1',
          skillVersionIds: [],
        }),
      );
    });
    const payload = JSON.stringify(onSave.mock.calls[0]![0]);
    expect(payload).not.toMatch(/sk-/i);
    expect(payload).not.toContain('secret');
  });

  it('toggles skill allowlist without auto-importing and saves selected ids', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        credentials={credentials}
        skills={skills}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId('agent-skills')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-skill-toggle-skv-1'));
    fireEvent.click(screen.getByTestId('agent-save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          skillVersionIds: ['skv-1'],
          defaultModelId: 'm1',
        }),
      );
    });
  });

  it('imports SKILL.md via onImportSkill and clears draft', async () => {
    const onImportSkill = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        skills={[]}
        onImportSkill={onImportSkill}
      />,
    );

    const md = '---\nname: panel-import\nversion: 0.1.0\n---\nBody';
    fireEvent.change(screen.getByTestId('agent-skill-md'), { target: { value: md } });
    fireEvent.click(screen.getByTestId('agent-skill-import-btn'));

    await waitFor(() => {
      expect(onImportSkill).toHaveBeenCalledWith(md);
    });
    expect((screen.getByTestId('agent-skill-md') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows empty hint when no binding', () => {
    render(<AgentBindingPanel binding={null} models={[]} />);
    expect(screen.getByTestId('agent-empty')).toBeTruthy();
  });

  it('toggles MCP allowlist and saves selected mcpServerIds (§9.3)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const mcpServers = [
      {
        mcpServerId: 'mcp-1',
        name: 'filesystem',
        transport: 'local-stdio',
        endpoint: 'npx://demo',
        toolCount: 2,
        trusted: false,
      },
      {
        mcpServerId: 'mcp-2',
        name: 'search',
        toolCount: 1,
        trusted: true,
      },
    ];
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        credentials={credentials}
        skills={skills}
        mcpServers={mcpServers}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId('agent-mcp')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-mcp-toggle-mcp-1'));
    fireEvent.click(screen.getByTestId('agent-save'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerIds: ['mcp-1'],
          defaultModelId: 'm1',
        }),
      );
    });
  });

  it('registers MCP metadata via onRegisterMcp without spawning', async () => {
    const onRegisterMcp = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[]}
        onRegisterMcp={onRegisterMcp}
      />,
    );

    fireEvent.change(screen.getByTestId('agent-mcp-name'), { target: { value: 'demo-fs' } });
    fireEvent.change(screen.getByTestId('agent-mcp-endpoint'), { target: { value: 'stdio://demo' } });
    fireEvent.change(screen.getByTestId('agent-mcp-tools'), { target: { value: 'read_file,list_dir' } });
    fireEvent.click(screen.getByTestId('agent-mcp-register-btn'));

    await waitFor(() => {
      expect(onRegisterMcp).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'demo-fs',
          endpoint: 'stdio://demo',
          toolsJson: 'read_file,list_dir',
        }),
      );
    });
  });


  it('registers MCP with timeout/maxOutputBytes policy fields', async () => {
    const onRegisterMcp = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[]}
        onRegisterMcp={onRegisterMcp}
      />,
    );

    fireEvent.change(screen.getByTestId('agent-mcp-name'), { target: { value: 'demo-fs' } });
    fireEvent.change(screen.getByTestId('agent-mcp-timeout'), { target: { value: '8000' } });
    fireEvent.change(screen.getByTestId('agent-mcp-max-bytes'), { target: { value: '4096' } });
    fireEvent.click(screen.getByTestId('agent-mcp-register-btn'));

    await waitFor(() => {
      expect(onRegisterMcp).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'demo-fs',
          timeoutMs: 8000,
          maxOutputBytes: 4096,
        }),
      );
    });
  });

  it('probes MCP policy via onProbeMcpPolicy without spawn', async () => {
    const onProbeMcpPolicy = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'filesystem',
            policyLabel: '15s · 64KB · untrusted',
            trusted: false,
          },
        ]}
        onProbeMcpPolicy={onProbeMcpPolicy}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-mcp-toggle-mcp-1'));
    fireEvent.click(screen.getByTestId('agent-mcp-probe-btn'));

    await waitFor(() => {
      expect(onProbeMcpPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerId: 'mcp-1',
          simulatedOutput: expect.stringContaining('PROBE-'),
        }),
      );
    });
  });

  it('requests MCP tool approval via onRequestMcpTool without spawn', async () => {
    const onRequestMcpTool = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'filesystem',
            toolCount: 2,
            trusted: false,
          },
        ]}
        onRequestMcpTool={onRequestMcpTool}
      />,
    );

    fireEvent.change(screen.getByTestId('agent-mcp-tool-name'), {
      target: { value: 'write_file' },
    });
    fireEvent.click(screen.getByTestId('agent-mcp-toggle-mcp-1'));
    fireEvent.click(screen.getByTestId('agent-mcp-request-btn'));

    await waitFor(() => {
      expect(onRequestMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerId: 'mcp-1',
          toolName: 'write_file',
          forceSensitive: true,
        }),
      );
    });
  });


  it('probes real MCP spawn via onProbeMcpSpawn', async () => {
    const onProbeMcpSpawn = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'demo',
            endpoint: 'node -e "process.stdout.write(1)"',
            transport: 'local-stdio',
          },
        ]}
        onProbeMcpSpawn={onProbeMcpSpawn}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-mcp-toggle-mcp-1'));
    fireEvent.click(screen.getByTestId('agent-mcp-spawn-btn'));
    await waitFor(() => {
      expect(onProbeMcpSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerId: 'mcp-1',
        }),
      );
    });
  });

  it('calls real MCP tool via onCallMcpTool', async () => {
    const onCallMcpTool = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'mini',
            endpoint: 'node server.mjs',
            toolCount: 2,
            trusted: false,
          },
        ]}
        onCallMcpTool={onCallMcpTool}
      />,
    );
    fireEvent.change(screen.getByTestId('agent-mcp-tool-name'), {
      target: { value: 'echo' },
    });
    fireEvent.click(screen.getByTestId('agent-mcp-toggle-mcp-1'));
    fireEvent.click(screen.getByTestId('agent-mcp-call-btn'));
    await waitFor(() => {
      expect(onCallMcpTool).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerId: 'mcp-1',
          toolName: 'echo',
        }),
      );
    });
  });

  it('refreshes MCP tool catalog via onRefreshMcpTools', async () => {
    const onRefreshMcpTools = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'mini',
            endpoint: 'node server.mjs',
            toolCount: 0,
            trusted: false,
          },
        ]}
        onRefreshMcpTools={onRefreshMcpTools}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-mcp-toggle-mcp-1'));
    fireEvent.click(screen.getByTestId('agent-mcp-refresh-btn'));
    await waitFor(() => {
      expect(onRefreshMcpTools).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerId: 'mcp-1',
        }),
      );
    });
  });

  it('shows discovered MCP tool name chips and empty catalog hint', () => {
    const { rerender } = render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'mini',
            endpoint: 'node server.mjs',
            toolCount: 0,
            toolNames: [],
            trusted: false,
          },
        ]}
      />,
    );
    expect(screen.getByTestId('agent-mcp-tools-empty-mcp-1').textContent || '').toMatch(/目录空/);

    rerender(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'mini',
            endpoint: 'node server.mjs',
            toolCount: 3,
            toolNames: ['echo', 'ping', 'write_file'],
            trusted: false,
          },
        ]}
      />,
    );
    const chipsText = screen.getByTestId('agent-mcp-tools-mcp-1').textContent || '';
    expect(chipsText).toContain('echo');
    expect(chipsText).toContain('ping');
    expect(chipsText).toContain('write_file');
  });


  it('fills tool name when clicking a discovered chip', () => {
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'mini',
            toolCount: 2,
            toolNames: ['echo', 'ping'],
            trusted: false,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-mcp-tool-chip-mcp-1-echo'));
    const input = screen.getByTestId('agent-mcp-tool-name') as HTMLInputElement;
    expect(input.value).toBe('echo');
  });

  it('exposes binding precedence ladder in Chinese', () => {
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        credentials={credentials}
        skills={skills}
        onSave={async () => undefined}
      />,
    );
    expect(screen.getByTestId('agent-precedence')).toBeTruthy();
    expect(screen.getByTestId('agent-precedence-run').textContent).toMatch(/本轮覆盖/);
    expect(screen.getByTestId('agent-precedence-agent').textContent).toMatch(/Agent 默认/);
    expect(screen.getByTestId('agent-precedence-fallback').textContent).toMatch(/GW · pro|m2/);
    expect(screen.getByTestId('agent-precedence-note').textContent).toMatch(/发送时|Fallback/);
  });


  it('shows empty capability readiness when no binding', () => {
    render(<AgentBindingPanel binding={null} models={[]} />);
    const strip = screen.getByTestId('agent-capability-readiness');
    expect(strip.getAttribute('data-level')).toBe('empty');
    expect(screen.getByTestId('agent-capability-badge').textContent).toMatch(/未加载/);
    expect(screen.getByTestId('agent-cap-check-model').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('agent-cap-check-dirty').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('agent-capability-note').textContent).toMatch(/导入|白名单|Runtime/);
  });

  it('shows partial capability readiness with default model but no cred / skill / mcp extras', () => {
    render(
      <AgentBindingPanel
        binding={{
          ...binding,
          fallbackModelIds: [],
          defaultCredentialGroupId: 'credential-group-unassigned',
          skillVersionIds: [],
          mcpServerIds: [],
        }}
        models={models}
        credentials={credentials}
        skills={skills}
        onSave={async () => undefined}
      />,
    );
    const strip = screen.getByTestId('agent-capability-readiness');
    expect(strip.getAttribute('data-level')).toBe('partial');
    expect(screen.getByTestId('agent-capability-badge').textContent).toMatch(/进行中/);
    expect(screen.getByTestId('agent-cap-check-model').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('agent-cap-check-fallback').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('agent-cap-check-cred').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('agent-cap-check-skill').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('agent-cap-check-mcp').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('agent-cap-check-dirty').getAttribute('data-ok')).toBe('1');
  });

  it('shows ready capability readiness when model + cred + fallback/skill/mcp bound and flips dirty on edit', () => {
    render(
      <AgentBindingPanel
        binding={{
          ...binding,
          defaultModelId: 'm1',
          fallbackModelIds: ['m2'],
          defaultCredentialGroupId: 'cg-a',
          pinnedCredentialRefId: 'cr-a1',
          skillVersionIds: ['skv-1'],
          mcpServerIds: [],
        }}
        models={models}
        credentials={credentials}
        skills={skills}
        mcpServers={[
          {
            mcpServerId: 'mcp-1',
            name: 'filesystem',
            transport: 'local-stdio',
            toolCount: 1,
          },
        ]}
        onSave={async () => undefined}
      />,
    );
    const strip = screen.getByTestId('agent-capability-readiness');
    expect(strip.getAttribute('data-level')).toBe('ready');
    expect(screen.getByTestId('agent-capability-badge').textContent).toMatch(/能力已配/);
    expect(screen.getByTestId('agent-cap-check-model').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('agent-cap-check-fallback').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('agent-cap-check-cred').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('agent-cap-check-skill').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('agent-cap-check-dirty').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('agent-cap-check-cred').textContent).toMatch(/已固定/);

    // ModelPathBoard embedded — models listed under surface/group
    let m2 = screen.queryByTestId('agent-default-model-model-m2');
    if (!m2) {
      const groups = screen.queryAllByTestId(/agent-default-model-group-/);
      for (const g of groups) fireEvent.click(g);
      m2 = screen.queryByTestId('agent-default-model-model-m2');
    }
    if (!m2) {
      // generic surface may hold all test models without provider surface
      const surfaces = screen.queryAllByTestId(/agent-default-model-surface-/);
      for (const s of surfaces) fireEvent.click(s);
    }
    fireEvent.click(screen.getByTestId('agent-default-model-model-m2'));
    expect(screen.getByTestId('agent-cap-check-dirty').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('agent-cap-check-dirty').textContent).toMatch(/未保存/);
  });

  it('locks every editable binding control while a selected Agent is loading', () => {
    render(
      <AgentBindingPanel
        binding={binding}
        models={models}
        loading
        onSave={async () => undefined}
      />,
    );

    expect(screen.getByTestId('agent-credential-group')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('agent-pause-toggle').querySelector('input')).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByTestId('agent-save')).toHaveProperty('disabled', true);
  });


});

describe('projectAgentCapabilityReadiness', () => {
  it('projects empty when no binding loaded', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: false,
      defaultModelId: '',
      fallbackModelIds: [],
      credentialGroupId: 'credential-group-unassigned',
      skillLibraryCount: 0,
      mcpLibraryCount: 0,
    });
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('未加载');
    expect(r.modelOk).toBe(false);
    expect(r.note).toMatch(/Runtime|Skill|MCP/);
  });

  it('projects empty when binding exists but default model missing', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: true,
      defaultModelId: '   ',
      fallbackModelIds: ['m2'],
      credentialGroupId: 'cg-a',
      skillVersionIds: ['skv-1'],
      skillLibraryCount: 2,
      mcpLibraryCount: 1,
      credentialOptionCount: 2,
    });
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('缺默认模型');
    expect(r.modelOk).toBe(false);
    expect(r.hasCredGroup).toBe(true);
    expect(r.skillBound).toBe(1);
    expect(r.note).toMatch(/默认模型|Fallback/);
  });

  it('projects partial with model only (no cred / skill / mcp / fallback extras)', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: true,
      defaultModelId: 'm1',
      fallbackModelIds: [],
      credentialGroupId: 'credential-group-unassigned',
      skillVersionIds: [],
      mcpServerIds: [],
      skillLibraryCount: 2,
      mcpLibraryCount: 1,
      credentialOptionCount: 3,
    });
    expect(r.level).toBe('partial');
    expect(r.badge).toBe('进行中');
    expect(r.modelOk).toBe(true);
    expect(r.hasCredGroup).toBe(false);
    expect(r.credOk).toBe(true);
    expect(r.fallbackCount).toBe(0);
    expect(r.skillBound).toBe(0);
    expect(r.mcpBound).toBe(0);
    expect(r.note).toMatch(/导入|白名单/);
  });

  it('projects partial when model + cred but no skill/mcp/fallback', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: true,
      defaultModelId: 'm1',
      fallbackModelIds: [],
      credentialGroupId: 'cg-a',
      pinnedCredentialRefId: 'cr-a1',
      skillVersionIds: [],
      mcpServerIds: [],
      skillLibraryCount: 1,
      mcpLibraryCount: 0,
      credentialOptionCount: 2,
    });
    expect(r.level).toBe('partial');
    expect(r.hasCredGroup).toBe(true);
    expect(r.pinOk).toBe(true);
    expect(r.badge).toBe('进行中');
  });

  it('projects ready when model + cred + fallback chain', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: true,
      defaultModelId: 'm1',
      fallbackModelIds: ['m2', 'm3'],
      credentialGroupId: 'cg-a',
      skillVersionIds: [],
      mcpServerIds: [],
      skillLibraryCount: 0,
      mcpLibraryCount: 0,
      credentialOptionCount: 1,
    });
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('能力已配');
    expect(r.fallbackCount).toBe(2);
    expect(r.note).toMatch(/dogfood|soft|M1/);
    expect(r.note).not.toMatch(/仍需.*外网/);
  });

  it('projects ready when model + cred + skill allowlist only', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: true,
      defaultModelId: 'm1',
      fallbackModelIds: [],
      credentialGroupId: 'cg-a',
      skillVersionIds: ['skv-1'],
      mcpServerIds: [],
      skillLibraryCount: 2,
      mcpLibraryCount: 0,
    });
    expect(r.level).toBe('ready');
    expect(r.skillBound).toBe(1);
    expect(r.skillLib).toBe(2);
    expect(r.mcpBound).toBe(0);
  });

  it('projects ready when model + cred + mcp allowlist only', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: true,
      defaultModelId: 'm1',
      fallbackModelIds: [],
      credentialGroupId: 'cg-b',
      skillVersionIds: [],
      mcpServerIds: ['mcp-1'],
      skillLibraryCount: 0,
      mcpLibraryCount: 3,
    });
    expect(r.level).toBe('ready');
    expect(r.mcpBound).toBe(1);
    expect(r.mcpLib).toBe(3);
  });

  it('does not reach ready with skill/mcp/fallback if credential group unbound', () => {
    const r = projectAgentCapabilityReadiness({
      hasBinding: true,
      defaultModelId: 'm1',
      fallbackModelIds: ['m2'],
      credentialGroupId: 'credential-group-unassigned',
      skillVersionIds: ['skv-1'],
      mcpServerIds: ['mcp-1'],
      skillLibraryCount: 2,
      mcpLibraryCount: 1,
    });
    expect(r.level).toBe('partial');
    expect(r.hasCredGroup).toBe(false);
    expect(r.fallbackCount).toBe(1);
    expect(r.skillBound).toBe(1);
    expect(r.mcpBound).toBe(1);
  });
});
