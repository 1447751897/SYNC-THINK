/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { ExecutionProcessStep, RunProcessView } from '@sync-think/protocol';
import {
  CodePreview,
  ExecutionProcessBlock,
  FileChangesCard,
  LineDiffView,
  looksLikeUnifiedDiff,
  parseUnifiedDiff,
  resolveAbsoluteProjectPath,
} from './ExecutionProcessBlock.js';

function step(overrides: Partial<ExecutionProcessStep> = {}): ExecutionProcessStep {
  return {
    id: 'step-1',
    label: 'git status',
    verb: 'run',
    zh: '执行',
    toolName: 'run_command',
    kind: 'bash',
    status: 'running',
    command: 'git status',
    ...overrides,
  };
}

describe('line diff presentation', () => {
  afterEach(cleanup);
  it('shows old/new gutters and syntax highlighting without modifying source', () => {
    const { container } = render(
      <LineDiffView
        oldText={'const value = 1;\nreturn value;'}
        newText={'const value = 2;\nreturn value;'}
        path="src/value.ts"
      />,
    );
    const removed = container.querySelector('[data-kind="del"]')!;
    const added = container.querySelector('[data-kind="add"]')!;
    expect(removed.querySelector('[data-old-line]')?.textContent).toBe('1');
    expect(removed.querySelector('[data-new-line]')?.textContent).toBe('');
    expect(added.querySelector('[data-new-line]')?.textContent).toBe('1');
    expect(added.querySelector('.hljs-keyword')).toBeTruthy();
    expect(added.querySelector('code')?.textContent).toBe('const value = 2;');
    expect(screen.getByRole('button', { name: '复制修改后内容' })).toBeTruthy();
  });

  it('does not present truncated snapshots as a complete diff', () => {
    const { container } = render(<LineDiffView oldText="before" newText="after" truncated />);
    expect(container.querySelector('[data-kind]')).toBeNull();
    expect(screen.queryByRole('button', { name: '复制修改后内容' })).toBeNull();
  });

  it('does not invent a deleted blank line for a newly created file', () => {
    const { container } = render(
      <LineDiffView oldText="" newText="const created = true;" path="created.ts" />,
    );
    expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
  });

  it('keeps missing and oversized snapshots out of the diff renderer', () => {
    const { container, rerender } = render(<LineDiffView oldText={undefined} newText="after" />);
    expect(container.querySelector('[data-kind]')).toBeNull();
    rerender(<LineDiffView oldText={Array(401).fill('before').join('\n')} newText="after" />);
    expect(container.querySelector('[data-kind]')).toBeNull();
  });
});

function processView(steps: ExecutionProcessStep[]): RunProcessView {
  return {
    runId: 'run-1',
    steps,
    fileChanges: [],
    running: true,
    doneCount: 0,
    errorCount: 0,
  } as unknown as RunProcessView;
}

function processViewWithChanges(): RunProcessView {
  return {
    ...processView([]),
    fileChanges: [
      {
        path: 'src/app.ts',
        action: 'edited',
        preview: 'const value = 2;',
        previousContent: 'const value = 1;',
        content: 'const value = 2;',
      },
    ],
  } as unknown as RunProcessView;
}

function processViewWithManyChanges(count: number): RunProcessView {
  return {
    ...processView([]),
    fileChanges: Array.from({ length: count }, (_, index) => ({
      path: `file-${index + 1}.ts`,
      action: 'edited' as const,
    })),
  } as unknown as RunProcessView;
}

/** Match the header row regardless of how the title is formatted. */
function headerRow(): Element | null {
  return screen.getByTestId('execution-process').querySelector('.shell-tool-card');
}

afterEach(() => {
  cleanup();
});

describe('ExecutionProcessBlock step collapse', () => {
  it('renders a running step folded by default while streaming', () => {
    render(<ExecutionProcessBlock view={processView([step()])} />);

    expect(screen.getByText('执行 · git status')).toBeTruthy();
    expect(headerRow()?.getAttribute('data-open')).toBe('0');
  });

  it('preserves the folded state once a running step completes', () => {
    const { rerender } = render(<ExecutionProcessBlock view={processView([step()])} />);

    expect(headerRow()?.getAttribute('data-open')).toBe('0');

    rerender(
      <ExecutionProcessBlock view={processView([step({ status: 'done', preview: '已完成' })])} />,
    );

    expect(headerRow()?.getAttribute('data-open')).toBe('0');
    expect(screen.getByText('执行 · git status')).toBeTruthy();
  });

  it('keeps a finished step open when the user expanded it manually', () => {
    const { rerender } = render(
      <ExecutionProcessBlock view={processView([step({ status: 'done', preview: '已完成' })])} />,
    );

    // User clicks the folded header to inspect the finished step.
    act(() => {
      screen.getByText('执行 · git status').click();
    });

    expect(headerRow()?.getAttribute('data-open')).toBe('1');

    // Re-render with the same status must not force-collapse the manual choice.
    rerender(
      <ExecutionProcessBlock view={processView([step({ status: 'done', preview: '已完成' })])} />,
    );
    expect(headerRow()?.getAttribute('data-open')).toBe('1');
  });

  it('renders a failed step folded with its header still visible', () => {
    render(
      <ExecutionProcessBlock
        view={processView([step({ status: 'error', error: 'command not found' })])}
      />,
    );

    expect(headerRow()?.getAttribute('data-open')).toBe('0');
    expect(screen.getByText('执行 · git status')).toBeTruthy();
  });
});

describe('CodePreview language adaptation', () => {
  it.each([
    ['Dockerfile', 'FROM node:20\nRUN corepack enable', 'dockerfile'],
    ['scripts/setup.ps1', '$ErrorActionPreference = "Stop"', 'powershell'],
    ['config/app.toml', '[server]\nenabled = true', 'ini'],
    ['src/main.rs', 'fn main() { println!("ready"); }', 'rust'],
    ['schema/api.graphql', 'type Query { status: String! }', 'graphql'],
  ])('uses the matching grammar for %s', (path, text, language) => {
    render(<CodePreview path={path} text={text} />);

    const preview = screen.getByRole('region', { name: '文件内容预览' });
    expect(preview.getAttribute('data-language')).toBe(language);
    cleanup();
  });

  it('keeps unsupported formats readable as unmodified plain text', () => {
    const text = 'alpha <raw-tag> & untouched';
    render(<CodePreview path="fixtures/sample.unknown-format" text={text} />);

    const preview = screen.getByRole('region', { name: '文件内容预览' });
    expect(preview.getAttribute('data-language')).toBe('text');
    expect(preview.textContent).toContain(text);
    expect(preview.querySelector('.hljs-keyword')).toBeNull();
  });
});

describe('FileChangesCard interactions', () => {
  it('opens a file without toggling its inline diff', () => {
    const onOpenChange = vi.fn();
    render(
      <FileChangesCard
        view={processViewWithChanges()}
        projectFolder={'D:\\projects\\SYNC-THINK'}
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开文件 src/app.ts' }));

    expect(onOpenChange).toHaveBeenCalledWith('src/app.ts');
    expect(screen.queryByText('自动换行')).toBeNull();
  });

  it('uses the chevron only to toggle the inline diff', () => {
    const onOpenChange = vi.fn();
    render(<FileChangesCard view={processViewWithChanges()} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: '展开 src/app.ts diff' }));

    expect(screen.getByText('自动换行')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('passes the current run to review', () => {
    const view = processViewWithChanges();
    const onOpenReview = vi.fn();
    render(
      <FileChangesCard
        view={view}
        projectFolder={'D:\\projects\\SYNC-THINK'}
        onOpenReview={onOpenReview}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看变动' }));

    expect(onOpenReview).toHaveBeenCalledWith(view);
  });

  it('portals the absolute path tooltip outside the scrollable card on hover', () => {
    const { container } = render(
      <FileChangesCard
        view={processViewWithChanges()}
        projectFolder={'D:\\projects\\SYNC-THINK'}
      />,
    );
    const fileButton = screen.getByRole('button', { name: '打开文件 src/app.ts' });
    vi.spyOn(fileButton, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      width: 320,
      height: 32,
      top: 100,
      right: 420,
      bottom: 132,
      left: 100,
      toJSON: () => undefined,
    } as DOMRect);

    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(fileButton);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('D:\\projects\\SYNC-THINK\\src\\app.ts');
    expect(tooltip.parentElement).toBe(document.body);
    expect(container.contains(tooltip)).toBe(false);
    expect(tooltip.getAttribute('style')).toContain('left: 107px');
    expect(tooltip.getAttribute('style')).toContain('top: 139px');
    expect(fileButton.getAttribute('aria-describedby')).toBe(tooltip.id);

    fireEvent.mouseLeave(fileButton);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the path tooltip for keyboard focus', () => {
    render(
      <FileChangesCard
        view={processViewWithChanges()}
        projectFolder={'D:\\projects\\SYNC-THINK'}
      />,
    );
    const fileButton = screen.getByRole('button', { name: '打开文件 src/app.ts' });

    fireEvent.focus(fileButton);
    expect(screen.getByRole('tooltip').textContent).toBe('D:\\projects\\SYNC-THINK\\src\\app.ts');

    fireEvent.blur(fileButton);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows at most four files until the overflow list is expanded', () => {
    render(<FileChangesCard view={processViewWithManyChanges(8)} />);

    expect(screen.getByText('编辑了 8 个文件')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /打开文件/ })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: '打开文件 file-5.ts' })).toBeNull();

    const toggle = screen.getByRole('button', { name: '展开其余 4 个文件' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('还有 4 个文件');

    fireEvent.click(toggle);

    expect(screen.getAllByRole('button', { name: /打开文件/ })).toHaveLength(8);
    expect(screen.getByRole('button', { name: '打开文件 file-8.ts' })).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '收起其余文件' }).textContent).toContain('收起');
  });

  it('does not show an overflow toggle for four or fewer files', () => {
    render(<FileChangesCard view={processViewWithManyChanges(4)} />);

    expect(screen.getAllByRole('button', { name: /打开文件/ })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /展开其余/ })).toBeNull();
  });

  it('renders a stored unified diff with add/del backgrounds instead of a code preview', () => {
    const preview = [
      '@@ -5,2 +5,5 @@',
      ' keep',
      '+publishCustomTurtleSoupStory: vi.fn(),',
      '+consumeSlidingWindow: vi.fn(),',
      ' still',
    ].join('\n');
    render(
      <FileChangesCard
        view={{
          ...processView([]),
          fileChanges: [
            {
              path: 'D:\\projects\\cuitaliao\\src\\route.test.ts',
              action: 'edited',
              preview,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('route.test.ts')).toBeTruthy();
    expect(screen.getByText('D:\\projects\\cuitaliao\\src')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开 D:\\projects\\cuitaliao\\src\\route.test.ts diff' }));

    const added = screen.getByText('publishCustomTurtleSoupStory').closest('[data-kind="add"]');
    expect(added).toBeTruthy();
    expect(added?.querySelector('[data-new-line]')?.textContent).toBe('6');
    expect(screen.getByText('keep').closest('[data-kind="ctx"]')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '文件内容预览' })).toBeNull();
    expect(screen.getByRole('region', { name: '文件差异预览' })).toBeTruthy();
  });

  it('resolves project-relative paths without changing absolute paths', () => {
    expect(resolveAbsoluteProjectPath('D:\\projects\\SYNC-THINK', './src/app.ts')).toBe(
      'D:\\projects\\SYNC-THINK\\src\\app.ts',
    );
    expect(resolveAbsoluteProjectPath('D:\\projects\\SYNC-THINK', 'C:\\temp\\file.ts')).toBe(
      'C:\\temp\\file.ts',
    );
  });
});

describe('unified diff preview parsing', () => {
  it('detects hunk headers and numbers added lines from the new side', () => {
    expect(looksLikeUnifiedDiff('const value = 1;')).toBe(false);
    const rows = parseUnifiedDiff('@@ -5,2 +5,5 @@\n keep\n+added\n still\n');
    expect(rows.map((row) => [row.kind, row.oldLine, row.newLine, row.text])).toEqual([
      ['hunk', undefined, undefined, '@@ -5,2 +5,5 @@'],
      ['ctx', 5, 5, 'keep'],
      ['add', undefined, 6, 'added'],
      ['ctx', 6, 7, 'still'],
    ]);
  });
});
