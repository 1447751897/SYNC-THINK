/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./BrowserPanel.js', () => ({ BrowserPanel: () => <div data-testid="browser-panel" /> }));

import { RightDock } from './RightDock.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('RightDock project content search', () => {
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
});
