import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManifestPanel, projectManifestReadiness, type ManifestInspectView } from '../src/components/ManifestPanel.js';

const sample: ManifestInspectView = {
  id: 'ev-1',
  packetId: 'pkt-1',
  proofHash: 'abc123def456abc123def456abc123de',
  modelId: 'model-a',
  providerModelId: 'gpt-a',
  resolutionSource: 'agentDefault',
  agentVersionId: 'agent-v1',
  agentVersion: 3,
  skillVersionIds: ['skill-ver-alpha', 'skill-ver-beta'],
  mcpServerIds: [],
  policyId: 'policy-default',
  tokenEstimate: 48,
  includedSourceIds: ['msg-1', 'agent-instructions'],
  excludedSourceIds: ['old-ref'],
  included: [
    { id: 'msg-1', kind: 'message-excerpt', tokenEstimate: 16 },
    { id: 'agent-instructions', kind: 'agent-instructions', tokenEstimate: 32 },
  ],
  excluded: [{ id: 'old-ref', kind: 'cross-task-ref', tokenEstimate: 20 }],
  summaries: [{ sourceId: 'msg-1', summary: 'hello world' }],
  truncations: [],
  crossTaskRefs: [],
  occurredAt: '2026-07-12T01:00:00.000Z',
};

describe('ManifestPanel', () => {
  it('renders inspectable proof, included sources, and selection', () => {
    const onSelect = vi.fn();
    render(
      <ManifestPanel
        manifests={[sample, { ...sample, id: 'ev-2', packetId: 'pkt-2', providerModelId: 'gpt-b' }]}
        selectedId="ev-1"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByTestId('manifest-panel')).toBeTruthy();
    expect(screen.getByTestId('manifest-packet-id').textContent).toBe('pkt-1');
    expect(screen.getByTestId('manifest-proof-hash').textContent).toMatch(/abc123/);
    expect(screen.getByTestId('manifest-model').textContent).toMatch(/gpt-a/);
    expect(screen.getByTestId('manifest-tokens').textContent).toMatch(/48/);
    expect(screen.getByTestId('manifest-included-count').textContent).toBe('2');
    expect(screen.getByTestId('manifest-included-msg-1')).toBeTruthy();
    expect(screen.getByTestId('manifest-excluded-old-ref')).toBeTruthy();
    expect(screen.getByText(/hello world/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('manifest-call-ev-2'));
    expect(onSelect).toHaveBeenCalledWith('ev-2');
  });

  it('shows empty state when no manifests', () => {
    render(<ManifestPanel manifests={[]} />);
    expect(screen.getByTestId('manifest-empty')).toBeTruthy();
  });

  it('renders explicit cross-task refs section when present', () => {
    render(
      <ManifestPanel
        manifests={[
          {
            ...sample,
            id: 'ev-xref',
            crossTaskRefs: ['parent-9'],
            included: [
              ...(sample.included ?? []),
              { id: 'cross-task:parent-9', kind: 'cross-task-ref', tokenEstimate: 24 },
            ],
            summaries: [
              ...(sample.summaries ?? []),
              {
                sourceId: 'cross-task:parent-9',
                summary: '父任务 · Parent plan — Ship multi-model',
              },
            ],
          },
        ]}
        selectedId="ev-xref"
      />,
    );
    expect(screen.getByTestId('manifest-cross-task-section')).toBeTruthy();
    expect(screen.getByTestId('manifest-cross-task-count').textContent).toBe('1');
    expect(screen.getByTestId('manifest-cross-task-parent-9')).toBeTruthy();
    expect(screen.getByTestId('manifest-cross-task-kv').textContent).toMatch(/1/);
    const row = screen.getByTestId('manifest-cross-task-parent-9');
    expect(row.textContent || '').toMatch(/Parent plan|parent-9|显式父任务/);
  });
});


describe('ManifestPanel memory evidence', () => {
  it('renders memory evidence section when evidenceRefsForMemory present', () => {
    const withMem: ManifestInspectView = {
      ...sample,
      included: [
        { id: 'memory:m1', kind: 'project-memory', tokenEstimate: 24 },
        { id: 'msg-1', kind: 'message-excerpt', tokenEstimate: 16 },
      ],
      includedSourceIds: ['memory:m1', 'msg-1'],
      summaries: [
        { sourceId: 'memory:m1', summary: '记忆 · binding-rule：run override beats agent default' },
      ],
      evidenceRefsForMemory: ['memory:m1'],
    };
    render(<ManifestPanel manifests={[withMem]} selectedId="ev-1" />);
    expect(screen.getByTestId('manifest-memory-evidence-section')).toBeTruthy();
    expect(screen.getByTestId('manifest-memory-evidence-count').textContent).toBe('1');
    expect(screen.getByTestId('manifest-memory-evidence-kv').textContent).toMatch(/1/);
    expect(screen.getAllByText(/binding-rule|run override/).length).toBeGreaterThanOrEqual(1);
  });
});


describe('ManifestPanel peek', () => {
  it('fires onPeek from header preview button', () => {
    const onPeek = vi.fn();
    render(
      <ManifestPanel
        manifests={[sample]}
        selectedId="ev-1"
        onPeek={onPeek}
      />,
    );
    fireEvent.click(screen.getByTestId('manifest-peek'));
    expect(onPeek).toHaveBeenCalledTimes(1);
  });

  it('disables peek button when peekBusy', () => {
    render(
      <ManifestPanel
        manifests={[]}
        onPeek={() => undefined}
        peekBusy
      />,
    );
    const btn = screen.getByTestId('manifest-peek') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('manifest-empty-peek-hint')).toBeTruthy();
  });
  it('shows Chinese resolution ladder aligned with binding precedence', () => {
    render(
      <ManifestPanel
        manifests={[
          {
            ...sample,
            id: 'ev-run',
            resolutionSource: 'runOverride',
            fallbackIndex: undefined,
          },
          {
            ...sample,
            id: 'ev-fb',
            resolutionSource: 'agentFallback',
            fallbackIndex: 0,
            providerModelId: 'gpt-fallback',
          },
        ]}
        selectedId="ev-run"
      />,
    );
    expect(screen.getByTestId('manifest-resolve-ladder').textContent).toMatch(/本轮覆盖/);
    expect(screen.getByTestId('manifest-resolve-ladder').textContent).toMatch(/优先级/);
    expect(screen.getByTestId('manifest-resolution').textContent).toMatch(/本轮覆盖/);
    // switch mentally: fallback selected via list would show Fallback
    // re-render fallback selected
  });

  it('shows Fallback chain position when resolution is agentFallback', () => {
    render(
      <ManifestPanel
        manifests={[
          {
            ...sample,
            id: 'ev-fb',
            resolutionSource: 'agentFallback',
            fallbackIndex: 1,
            providerModelId: 'gpt-fb-2',
          },
        ]}
        selectedId="ev-fb"
      />,
    );
    expect(screen.getByTestId('manifest-resolution-badge').textContent).toMatch(/Fallback/);
    expect(screen.getByTestId('manifest-resolution').textContent).toMatch(/链位 #2/);
    expect(screen.getByTestId('manifest-resolve-ladder').textContent).toMatch(/Fallback #2/);
  });

});

describe('ManifestPanel amend', () => {
  it('shows exclude control for non-protected included sources', () => {
    const onExclude = vi.fn();
    render(
      <ManifestPanel
        manifests={[sample]}
        selectedId="ev-1"
        onExcludeSource={onExclude}
      />,
    );
    // message-excerpt remains user-excludable; Agent instructions are protected.
    const btn = screen.getByTestId('manifest-exclude-msg-1');
    fireEvent.click(btn);
    expect(onExclude).toHaveBeenCalledWith('msg-1');
  });

  it('shows agent / skill / policy version metadata (§10.3)', () => {
    render(<ManifestPanel manifests={[sample]} selectedId="ev-1" />);
    expect(screen.getByTestId('manifest-agent-version').textContent).toMatch(/v3/);
    expect(screen.getByTestId('manifest-skill-versions').textContent).toMatch(/2/);
    expect(screen.getByTestId('manifest-skill-versions').textContent).toMatch(/skill-ver/);
    expect(screen.getByTestId('manifest-policy-id').textContent).toMatch(/policy-default/);
  });

  it('shows skill-definition 入包 count when included sources have skills (§10.2)', () => {
    const withSkillBody: ManifestInspectView = {
      ...sample,
      skillVersionIds: ['skill-ver-1'],
      included: [
        ...sample.included!,
        { id: 'skill:skill-ver-1', kind: 'skill-definition', tokenEstimate: 48 },
      ],
      includedSourceIds: [...(sample.includedSourceIds ?? []), 'skill:skill-ver-1'],
      summaries: [
        ...(sample.summaries ?? []),
        { sourceId: 'skill:skill-ver-1', summary: 'Skill · minimal@0.1.0 — body' },
      ],
    };
    render(<ManifestPanel manifests={[withSkillBody]} selectedId="ev-1" />);
    expect(screen.getByTestId('manifest-skill-source-count').textContent).toMatch(/入包 1/);
    expect(screen.getByTestId('manifest-skill-versions').textContent).toMatch(/1/);
  });

  it('shows mcp allowlist and tool-schema 入包 count (§9.3)', () => {
    const withMcp: ManifestInspectView = {
      ...sample,
      mcpServerIds: ['mcp-fs-server-1'],
      included: [
        ...(sample.included ?? []),
        { id: 'tool:mcp-fs-server-1:read_file', kind: 'tool-schema', tokenEstimate: 24 },
        { id: 'tool:mcp-fs-server-1:list_dir', kind: 'tool-schema', tokenEstimate: 20 },
      ],
      includedSourceIds: [
        ...(sample.includedSourceIds ?? []),
        'tool:mcp-fs-server-1:read_file',
        'tool:mcp-fs-server-1:list_dir',
      ],
    };
    render(<ManifestPanel manifests={[withMcp]} selectedId="ev-1" />);
    expect(screen.getByTestId('manifest-mcp-servers').textContent).toMatch(/1/);
    expect(screen.getByTestId('manifest-mcp-source-count').textContent).toMatch(/入包 2/);
  });

  it('shows mcp none when no allowlist and no tool-schema', () => {
    render(<ManifestPanel manifests={[{ ...sample, mcpServerIds: [] }]} selectedId="ev-1" />);
    expect(screen.getByTestId('manifest-mcp-servers').textContent).toMatch(/none/);
  });

  it('marks protected kinds without exclude control', () => {
    const protectedView: ManifestInspectView = {
      ...sample,
      included: [
        { id: 'task-goal:t1', kind: 'task-goal', tokenEstimate: 40 },
        { id: 'msg-1', kind: 'message-excerpt', tokenEstimate: 16 },
      ],
      includedSourceIds: ['task-goal:t1', 'msg-1'],
    };
    render(
      <ManifestPanel
        manifests={[protectedView]}
        selectedId="ev-1"
        onExcludeSource={() => undefined}
      />,
    );
    expect(screen.getByTestId('manifest-protected-task-goal:t1')).toBeTruthy();
    expect(screen.queryByTestId('manifest-exclude-task-goal:t1')).toBeNull();
    expect(screen.getByTestId('manifest-exclude-msg-1')).toBeTruthy();
  });

  it('shows amend bar and clear button when active excludes present', () => {
    const onClear = vi.fn();
    render(
      <ManifestPanel
        manifests={[sample]}
        selectedId="ev-1"
        activeExcludeSourceIds={['msg-1']}
        amendStatus="已排除 msg-1"
        onClearAmendments={onClear}
      />,
    );
    expect(screen.getByTestId('manifest-amend-bar')).toBeTruthy();
    expect(screen.getByTestId('manifest-amend-count').textContent).toMatch(/1/);
    expect(screen.getByTestId('manifest-amend-status').textContent).toMatch(/msg-1/);
    fireEvent.click(screen.getByTestId('manifest-clear-amends'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});


describe('Manifest readiness strip', () => {
  it('shows empty readiness with peek hint', () => {
    render(<ManifestPanel manifests={[]} onPeek={() => undefined} />);
    expect(screen.getByTestId('manifest-readiness').getAttribute('data-level')).toBe('empty');
    expect(screen.getByTestId('manifest-readiness-badge').textContent).toBe('可预览');
    expect(screen.getByTestId('manifest-check-calls').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('manifest-check-peek-amends').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('manifest-readiness-note').textContent).toMatch(/预览上下文/);
  });

  it('marks inspectable when proof + resolution present', () => {
    render(<ManifestPanel manifests={[sample]} selectedId="ev-1" />);
    expect(screen.getByTestId('manifest-readiness').getAttribute('data-level')).toBe('inspectable');
    expect(screen.getByTestId('manifest-readiness-badge').textContent).toBe('可检查');
    expect(screen.getByTestId('manifest-check-calls').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('manifest-check-selected').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('manifest-check-resolution').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('manifest-check-proof').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('manifest-check-included').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('manifest-check-skill-tool').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('manifest-panel').getAttribute('data-level')).toBe('inspectable');
  });

  it('marks amended when active excludes present', () => {
    render(
      <ManifestPanel
        manifests={[sample]}
        selectedId="ev-1"
        activeExcludeSourceIds={['msg-1']}
      />,
    );
    expect(screen.getByTestId('manifest-readiness').getAttribute('data-level')).toBe('amended');
    expect(screen.getByTestId('manifest-readiness-badge').textContent).toBe('已修订');
    expect(screen.getByTestId('manifest-check-peek-amends').textContent).toMatch(/修订中/);
  });

  it('can hide readiness strip', () => {
    render(<ManifestPanel manifests={[]} hideReadiness />);
    expect(screen.queryByTestId('manifest-readiness')).toBeNull();
    expect(screen.getByTestId('manifest-empty')).toBeTruthy();
  });
});

describe('projectManifestReadiness', () => {
  it('projects empty when no manifests', () => {
    const r = projectManifestReadiness({ manifests: [] });
    expect(r.level).toBe('empty');
    expect(r.callCount).toBe(0);
    expect(r.badge).toBe('静默');
  });

  it('projects inspectable for full sample', () => {
    const r = projectManifestReadiness({ manifests: [sample], selectedId: 'ev-1' });
    expect(r.level).toBe('inspectable');
    expect(r.hasProof).toBe(true);
    expect(r.hasResolution).toBe(true);
    expect(r.hasSkill).toBe(true);
    expect(r.includedCount).toBe(2);
  });

  it('projects amended when excludes active', () => {
    const r = projectManifestReadiness({
      manifests: [sample],
      selectedId: 'ev-1',
      activeExcludeSourceIds: ['msg-1'],
    });
    expect(r.level).toBe('amended');
    expect(r.hasAmends).toBe(true);
  });
});
