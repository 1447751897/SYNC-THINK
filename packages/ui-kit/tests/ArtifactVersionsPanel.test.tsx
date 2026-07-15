import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArtifactVersionsPanel } from '../src/components/ArtifactVersionsPanel.js';

afterEach(() => cleanup());

const artifact = {
  id: 'artifact-1',
  name: 'design.md',
  selectedVersionId: 'artifact-version-2',
  versions: [
    {
      id: 'artifact-version-1',
      artifactId: 'artifact-1',
      version: 1,
      sourceStepId: 'design',
      status: 'candidate' as const,
      contentHash: 'hash-1',
      mimeType: 'text/markdown',
      parentVersionIds: [] as string[],
      createdAt: '2026-07-14T00:00:00.000Z',
    },
    {
      id: 'artifact-version-2',
      artifactId: 'artifact-1',
      version: 2,
      sourceStepId: 'rework-1',
      status: 'selected' as const,
      contentHash: 'hash-2',
      mimeType: 'text/markdown',
      parentVersionIds: ['artifact-version-1'],
      createdAt: '2026-07-14T00:05:00.000Z',
    },
  ],
};

const comparison = {
  leftVersionId: 'artifact-version-1',
  rightVersionId: 'artifact-version-2',
  comparison: {
    kind: 'text' as const,
    equal: false,
    hunks: [
      {
        leftStartLine: 1,
        rightStartLine: 1,
        removedLines: ['old'],
        addedLines: ['new'],
      },
    ],
  },
};

const mergeSteps = [
  {
    id: 'merge-ready',
    title: 'Merge design branches',
    dependsOn: ['design', 'rework-1'],
  },
];

const conflicts = [
  {
    id: 'conflict-1',
    artifactId: 'artifact-1',
    baseVersionId: 'artifact-version-0',
    leftVersionId: 'artifact-version-1',
    rightVersionId: 'artifact-version-2',
    sourceStepId: 'merge-ready',
    createdAt: '2026-07-15T00:00:00.000Z',
  },
];

describe('ArtifactVersionsPanel', () => {
  it('adapts graph controls and artifact versions to a narrow host drawer', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8');

    expect(css).toContain('@container (max-width: 420px)');
    expect(css).toMatch(
      /\.st-graph__controls,\s*\.st-artifacts__actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.st-artifacts__shelf\s*\{[^}]*grid-auto-flow:\s*row;[^}]*overflow-x:\s*hidden/s,
    );
  });

  it('keeps immutable versions visible and renders a stable comparison', () => {
    render(<ArtifactVersionsPanel artifact={artifact} comparison={comparison} />);

    expect(screen.getAllByTestId(/artifact-version-/)).toHaveLength(2);
    expect(screen.getByTestId('artifact-version-artifact-version-2').textContent).toContain('已选');
    expect(screen.getByTestId('artifact-comparison').textContent).toContain('old');
    expect(screen.getByTestId('artifact-comparison').textContent).toContain('new');
  });

  it('requests compare, select and merge with exact version ids', () => {
    const compare = vi.fn();
    const select = vi.fn();
    const merge = vi.fn();
    render(
      <ArtifactVersionsPanel
        artifact={artifact}
        comparison={comparison}
        mergeSteps={mergeSteps}
        onCompare={compare}
        onSelect={select}
        onMerge={merge}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '比较版本 1 与版本 2' }));
    fireEvent.click(screen.getByRole('button', { name: '选择版本 1' }));
    fireEvent.click(screen.getByRole('button', { name: '合并版本 1 与版本 2' }));

    expect(compare).toHaveBeenCalledWith('artifact-version-1', 'artifact-version-2');
    expect(select).toHaveBeenCalledWith('artifact-1', 'artifact-version-1');
    expect(merge).toHaveBeenCalledWith(
      'artifact-1',
      'artifact-version-1',
      'artifact-version-2',
      'merge-ready',
    );
  });

  it('resolves an open conflict from either branch or manual content', () => {
    const resolve = vi.fn();
    render(
      <ArtifactVersionsPanel
        artifact={artifact}
        conflicts={conflicts}
        onResolveConflict={resolve}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '采用右侧版本' }));
    fireEvent.click(screen.getByRole('button', { name: '解决冲突' }));
    expect(resolve).toHaveBeenLastCalledWith('conflict-1', 'right', undefined);

    fireEvent.click(screen.getByRole('button', { name: '手工合并' }));
    fireEvent.change(screen.getByLabelText('手工合并内容'), {
      target: { value: 'manual result' },
    });
    fireEvent.click(screen.getByRole('button', { name: '解决冲突' }));
    expect(resolve).toHaveBeenLastCalledWith('conflict-1', 'manual', 'manual result');
  });
});
