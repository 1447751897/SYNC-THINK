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
  it('renders only opaque artifact preview URLs with loading, metadata and dimensions', () => {
    const imageArtifact = {
      ...artifact,
      versions: [
        {
          ...artifact.versions[0],
          mimeType: 'image/png',
          hasContentRef: true,
          preview: {
            status: 'ready' as const,
            previewUrl: 'sync-think-image://artifact/abcdefghijklmnop',
            mimeType: 'image/png',
            byteLength: 2048,
            contentHash: 'a'.repeat(64),
          },
        },
      ],
    };
    const { rerender } = render(<ArtifactVersionsPanel artifact={imageArtifact} />);
    const image = screen.getByRole('img', { name: 'Artifact v1 图片预览' });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1024 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 768 });
    fireEvent.load(image);
    expect(screen.getByTestId('artifact-version-artifact-version-1').textContent).toContain(
      '2.0 KiB',
    );
    expect(screen.getByTestId('artifact-version-artifact-version-1').textContent).toContain(
      '1024 × 768',
    );

    rerender(
      <ArtifactVersionsPanel
        artifact={{
          ...imageArtifact,
          versions: [{ ...imageArtifact.versions[0], preview: { status: 'loading' as const } }],
        }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('图片预览加载中');

    rerender(
      <ArtifactVersionsPanel
        artifact={{
          ...imageArtifact,
          versions: [
            {
              ...imageArtifact.versions[0],
              preview: { ...imageArtifact.versions[0].preview, previewUrl: 'file:///secret.png' },
            },
          ],
        }}
      />,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('图片预览地址无效');
  });

  it('renders image candidates as a selection gallery without text comparison controls', () => {
    const select = vi.fn();
    const versions = [1, 2, 3].map((candidateIndex) => ({
      ...artifact.versions[0],
      id: `image-version-${candidateIndex}`,
      version: candidateIndex,
      mimeType: 'image/png',
      hasContentRef: true,
      imageGeneration: {
        candidateIndex,
        candidateCount: 3,
        size: '1536x1024',
        quality: 'high',
        byteLength: 2048 * candidateIndex,
      },
      preview: {
        status: 'ready' as const,
        previewUrl: `sync-think-image://artifact/abcdefghijklmn0${candidateIndex}`,
        mimeType: 'image/png',
        byteLength: 2048 * candidateIndex,
        contentHash: String(candidateIndex).repeat(64),
      },
    }));
    render(
      <ArtifactVersionsPanel
        artifact={{ id: 'image-artifact', name: 'Generated image', versions }}
        onSelect={select}
      />,
    );

    expect(screen.getByText('3 个图片候选')).toBeTruthy();
    expect(screen.getAllByText(/候选 [123]/)).toHaveLength(3);
    expect(screen.queryByTestId('artifact-comparison')).toBeNull();
    expect(screen.queryByRole('button', { name: /比较版本/ })).toBeNull();
    expect(screen.queryByText('左侧')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '选择候选 2' }));
    expect(select).toHaveBeenCalledWith('image-artifact', 'image-version-2');
  });
});
