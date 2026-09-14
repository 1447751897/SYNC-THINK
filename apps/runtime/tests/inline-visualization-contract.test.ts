import { describe, expect, it } from 'vitest';
import type { RunId } from '@sync-think/shared';
import { createDemoRun } from '../src/demo-run.js';
import { Runtime } from '../src/runtime.js';

type ProviderContextBuilder = {
  buildDefaultProviderContextSnapshot: (
    run: ReturnType<typeof createDemoRun>,
    options: { messages: Array<{ role: 'user'; content: string }>; toolsEnabled: boolean },
  ) => { providerRequest: { systemPrompt: string } };
};

type KernelContextBuilder = {
  buildKernelSystemContext: (
    run: ReturnType<typeof createDemoRun>,
    workspaceRoot?: string,
  ) => string;
};

const INLINE_CONTRACT_MARKER = 'AI inline visualization output contract (newmax-inline-vis):';

function expectInlineContract(prompt: string): void {
  expect(prompt).toContain(INLINE_CONTRACT_MARKER);
  expect(prompt).toContain(
    'first create the complete self-contained HTML document in the bound project by calling `write_file`',
  );
  expect(prompt).toContain(
    'Wait for an actual successful `write_file` result before emitting `::newmax-inline-vis{file="visualizations/<slug>.html"}`',
  );
  expect(prompt).toContain('exact normalized project-relative path');
  expect(prompt).toContain('standalone line outside Markdown fences');
  expect(prompt).toContain('Only emit the directive when a project folder is bound and the file write succeeded');
  expect(prompt).toContain('at or below 2 MiB');
  expect(prompt).toContain('distinct from in-message `html` fences and `excalidraw`');
  expect(prompt).not.toContain('emit `::newmax-inline-vis` before');
}

describe('Runtime inline visualization product contract', () => {
  it('injects the NewMax file-write-before-directive contract into provider context', () => {
    const runtime = new Runtime({
      installId: `inline-visualization-contract-${Date.now()}`,
      allowNoToken: true,
    });
    const run = createDemoRun(
      'run-inline-visualization-contract' as RunId,
      'thread-inline-visualization-contract',
      '请创建一个可在对话中预览的仪表盘',
    );
    const snapshot = (
      runtime as unknown as ProviderContextBuilder
    ).buildDefaultProviderContextSnapshot(run, {
      messages: [{ role: 'user', content: run.userText }],
      toolsEnabled: false,
    });

    expectInlineContract(snapshot.providerRequest.systemPrompt);
    expect(snapshot.providerRequest.systemPrompt.split(INLINE_CONTRACT_MARKER)).toHaveLength(2);
  });

  it('keeps the same contract in external-kernel system context', () => {
    const runtime = new Runtime({
      installId: `inline-visualization-kernel-contract-${Date.now()}`,
      allowNoToken: true,
    });
    const run = createDemoRun(
      'run-inline-visualization-kernel-contract' as RunId,
      'thread-inline-visualization-kernel-contract',
      'build and show the saved visualization',
      { kernelId: 'codex', modelId: 'gpt-5', providerModelId: 'gpt-5' },
    );

    const prompt = (
      runtime as unknown as KernelContextBuilder
    ).buildKernelSystemContext(run, 'D:/projects/demo');

    expectInlineContract(prompt);
    expect(prompt).toContain('Project folder: D:/projects/demo');
  });
});
