/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Phase3VisualFixture } from './Phase3VisualFixture.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(window, '__phase3CopiedText');
});

describe('workspace file visual fixture', () => {
  it('renders the real preview and source workflow', async () => {
    render(<Phase3VisualFixture visualCase="workspace-file" />);

    expect(await screen.findByTestId('workspace-file-view')).toBeTruthy();
    expect(document.querySelector('[data-language="bash"]')).toBeTruthy();
    expect(document.querySelector('[data-file-type="shell"]')).toBeTruthy();

    expect(document.querySelector('.shell-file-pane-path')).toBeNull();
    expect(screen.getByRole('tab', { name: '高亮预览' }).textContent).toBe('');
    expect(screen.getByRole('tab', { name: '源码' }).textContent).toBe('');
    expect(
      screen.getByRole('tab', { name: '高亮预览' }).getAttribute('aria-selected'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: '源码' }));
    const editor = screen.getByTestId('file-pane-editor') as HTMLTextAreaElement;
    expect(editor.hidden).toBe(false);
    expect(editor.wrap).toBe('soft');

    fireEvent.click(screen.getByRole('button', { name: '更多文件操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制源码' }));
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: '源码已复制' })).toBeTruthy(),
    );
    expect(
      (window as Window & { __phase3CopiedText?: string }).__phase3CopiedText,
    ).toBe(editor.value);
  });
});
