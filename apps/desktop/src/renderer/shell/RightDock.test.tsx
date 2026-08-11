/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./BrowserPanel.js', () => ({
  BrowserPanel: (props: { partition?: string; registerForAutomation?: boolean }) => (
    <div
      data-testid="browser-panel"
      data-partition={props.partition}
      data-register-for-automation={String(props.registerForAutomation)}
    />
  ),
}));

import { RightDock, WorkspaceFilesPanel } from './RightDock.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('RightDock project content search', () => {
  it('keeps the right-side browser as an ephemeral preview, separate from AI automation Profiles', () => {
    render(<RightDock initialTab="browser" onClose={vi.fn()} />);

    const preview = screen.getByTestId('browser-panel');
    expect(preview.getAttribute('data-partition')).toBe('browser-preview');
    expect(preview.getAttribute('data-register-for-automation')).toBe('false');
    expect(screen.getByRole('button', { name: '预览' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '工作区文件' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '工作区' })).toBeNull();
  });

  it('switches from filename search to bounded content matches and opens the exact line', async () => {
    const searchProjectContent = vi.fn(async () => ({
      engine: 'rg' as const,
      results: [
        {
          path: 'src/app.ts',
          line: 7,
          column: 17,
          preview: 'const marker = "Needle";',
          matchText: 'Needle',
        },
      ],
      truncated: false,
      timedOut: false,
    }));
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listProjectDir: vi.fn(async () => ({ dir: '', entries: [] })),
          listProjectFiles: vi.fn(async () => ({ root: 'C:/workspace', files: [] })),
          searchProjectContent,
        },
      },
    });
    const onOpenFile = vi.fn();

    render(
      <RightDock
        projectFolder="C:/workspace"
        initialTab="files"
        onOpenFile={onOpenFile}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '内容' }));
    fireEvent.change(screen.getByTestId('dock-files-search'), { target: { value: 'Needle' } });

    await waitFor(() =>
      expect(searchProjectContent).toHaveBeenCalledWith({
        root: 'C:/workspace',
        query: 'Needle',
        maxResults: 200,
      }),
    );
    expect(await screen.findByText('7:17')).toBeTruthy();
    expect(screen.getByText('const marker = "Needle";')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /src\/app\.ts.*7.*17/i }));
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts', { line: 7, column: 17 });
  });

  it('keeps legacy files/workspace initial tabs inside the unified workspace files panel', () => {
    const { rerender } = render(
      <RightDock projectFolder="C:/workspace" initialTab="workspace" onClose={vi.fn()} />,
    );

    expect(screen.getByTestId('workspace-files-panel')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '文件' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Git' }).getAttribute('aria-selected')).toBe('false');

    fireEvent.click(screen.getByRole('tab', { name: 'Git' }));
    expect(screen.getByRole('tab', { name: 'Git' }).getAttribute('aria-selected')).toBe('true');

    rerender(<RightDock projectFolder="C:/workspace" initialTab="files" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: '工作区文件' }).getAttribute('data-active')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: '文件' }).getAttribute('aria-selected')).toBe('true');
  });

  it('offers current-file and new-tab actions when embedded in a file view', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listProjectDir: vi.fn(async () => ({
            dir: '',
            entries: [{ path: 'src/app.ts', name: 'app.ts', kind: 'file' }],
          })),
          listProjectFiles: vi.fn(async () => ({ root: 'C:/workspace', files: [] })),
        },
      },
    });
    const onOpenFile = vi.fn();
    const onOpenFileInNewTab = vi.fn();

    render(
      <WorkspaceFilesPanel
        projectFolder="C:/workspace"
        activeFilePath="src/current.ts"
        onOpenFile={onOpenFile}
        onOpenFileInNewTab={onOpenFileInNewTab}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '在当前文件标签打开 src/app.ts' }));
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts', undefined);

    fireEvent.click(screen.getByRole('button', { name: '在新文件标签打开 src/app.ts' }));
    expect(onOpenFileInNewTab).toHaveBeenCalledWith('src/app.ts', undefined);
  });

  it('uses file-format icons in the workspace tree', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listProjectDir: vi.fn(async () => ({
            dir: '',
            entries: [
              { path: 'scripts/check.cjs', name: 'check.cjs', kind: 'file' },
              { path: 'scripts/report.py', name: 'report.py', kind: 'file' },
            ],
          })),
          listProjectFiles: vi.fn(async () => ({ root: 'C:/workspace', files: [] })),
        },
      },
    });

    render(<WorkspaceFilesPanel projectFolder="C:/workspace" />);

    expect(await screen.findByText('check.cjs')).toBeTruthy();
    expect(document.querySelector('[data-file-type="javascript"]')).toBeTruthy();
    expect(document.querySelector('[data-file-type="python"]')).toBeTruthy();
  });
});
