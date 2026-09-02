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

describe('Runtime design-html product contract', () => {
  it('injects the parseable design, preview, save, and browser boundaries into provider context', () => {
    const runtime = new Runtime({
      installId: `design-html-contract-${Date.now()}`,
      allowNoToken: true,
    });
    const run = createDemoRun(
      'run-design-html-contract' as RunId,
      'thread-design-html-contract',
      '请创建一个可保存的登录页设计稿',
    );
    const snapshot = (
      runtime as unknown as ContextSnapshotBuilder
    ).buildDefaultProviderContextSnapshot(run, {
      messages: [{ role: 'user', content: run.userText }],
      toolsEnabled: false,
    });
    const prompt = snapshot.providerRequest.systemPrompt;

    expect(prompt).toContain('AI design draft output contract (design-html):');
    expect(prompt).toContain('exactly one fenced block tagged `design-html`');
    expect(prompt).toContain(
      'complete `<!doctype html>` / `<html>` / `<head>` / `<body>` document',
    );
    expect(prompt).toContain('Put CSS and JavaScript inline');
    expect(prompt).toContain('visible page content and accessible labels/interactions');
    expect(prompt).toContain('at or below 1 MiB');
    expect(prompt).toContain('Preview, save, and browser-open are separate facts');
    expect(prompt).toContain('actual `browser_open` result');
    expect(prompt).toContain('successful `write_file` result');
    expect(prompt).toContain('project-relative path');
    expect(prompt).toContain('never claim that a file was saved before the tool reports success');
    expect(prompt).toContain(
      'do not call `write_file` and do not overwrite an existing design file',
    );
    expect(prompt).toContain('ordinary HTML examples should remain regular `html` code fences');
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
    expect(prompt).toContain('This contract is distinct from `design-html` and `excalidraw`');
  });
});
