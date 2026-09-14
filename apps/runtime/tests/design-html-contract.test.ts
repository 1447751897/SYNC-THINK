import { describe, expect, it } from 'vitest';
import type { RunId } from '@sync-think/shared';
import { createDemoRun } from '../src/demo-run.js';
import { Runtime } from '../src/runtime.js';

type ContextSnapshotBuilder = {
  buildDefaultProviderContextSnapshot: (
    run: ReturnType<typeof createDemoRun>,
    options: { messages: Array<{ role: 'user'; content: string }>; toolsEnabled: boolean },
  ) => { providerRequest: { systemPrompt: string } };
};

describe('Runtime html preview product contract', () => {
  it('injects the NewMax html-fence design contract into provider context', () => {
    const runtime = new Runtime({
      installId: `html-preview-contract-${Date.now()}`,
      allowNoToken: true,
    });
    const run = createDemoRun(
      'run-html-preview-contract' as RunId,
      'thread-html-preview-contract',
      '请创建一个可保存的登录页设计稿',
    );
    const snapshot = (
      runtime as unknown as ContextSnapshotBuilder
    ).buildDefaultProviderContextSnapshot(run, {
      messages: [{ role: 'user', content: run.userText }],
      toolsEnabled: false,
    });
    const prompt = snapshot.providerRequest.systemPrompt;

    expect(prompt).toContain('AI design draft output contract (html):');
    expect(prompt).toContain('exactly one fenced block tagged `html`');
    expect(prompt).toContain('` ```html `');
    expect(prompt).toContain('Put CSS and JavaScript inline');
    expect(prompt).toContain('visible page content and accessible labels/interactions');
    expect(prompt).toContain('Never use `design-ui`, `ui-design`, or `design-html` fences');
    expect(prompt).toContain('never emit a JSON UI-kit / node-tree artifact');
    expect(prompt).not.toContain('AI design draft output contract (design-ui):');
    expect(prompt).not.toContain('AI design draft output contract (design-html):');
    expect(prompt).not.toContain('AI editable design output contract (excalidraw):');
  });

  it('adds the editable Excalidraw contract only for an explicit source request', () => {
    const runtime = new Runtime({
      installId: `excalidraw-contract-${Date.now()}`,
      allowNoToken: true,
    });
    const run = createDemoRun(
      'run-excalidraw-contract' as RunId,
      'thread-excalidraw-contract',
      '请输出 Excalidraw 源文件，保存为 designs/login.excalidraw',
    );
    const snapshot = (
      runtime as unknown as ContextSnapshotBuilder
    ).buildDefaultProviderContextSnapshot(run, {
      messages: [{ role: 'user', content: run.userText }],
      toolsEnabled: false,
    });
    const prompt = snapshot.providerRequest.systemPrompt;

    expect(prompt).toContain('AI editable design output contract (excalidraw):');
    expect(prompt).toContain('Use this contract only when the user explicitly asks for Excalidraw');
  });

  it('injects the file-backed inline visualization contract and keeps it separate from drafts', () => {
    const runtime = new Runtime({
      installId: `inline-visualization-contract-${Date.now()}`,
      allowNoToken: true,
    });
    const run = createDemoRun(
      'run-inline-visualization-contract' as RunId,
      'thread-inline-visualization-contract',
      '请创建一个交互式数据可视化并显示在对话中',
    );
    const snapshot = (
      runtime as unknown as ContextSnapshotBuilder
    ).buildDefaultProviderContextSnapshot(run, {
      messages: [{ role: 'user', content: run.userText }],
      toolsEnabled: false,
    });
    const prompt = snapshot.providerRequest.systemPrompt;

    expect(prompt).toContain('AI inline visualization output contract (newmax-inline-vis):');
    expect(prompt).toContain('first create the complete self-contained HTML document in the bound project');
    expect(prompt).toContain('Wait for an actual successful `write_file` result before emitting');
    expect(prompt).toContain('`::newmax-inline-vis{file="visualizations/<slug>.html"}`');
    expect(prompt).toContain('do not invent a path, use an absolute path, or use a data URL');
    expect(prompt).toContain('Emit the directive as a standalone line outside Markdown fences');
    expect(prompt).toContain('Only emit the directive when a project folder is bound and the file write succeeded');
    expect(prompt).toContain('Inline preview, browser-open, and saving are separate facts');
    expect(prompt).toContain('This contract is distinct from in-message `html` fences and `excalidraw`');
  });
});
