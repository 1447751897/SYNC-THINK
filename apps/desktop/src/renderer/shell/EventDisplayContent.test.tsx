// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ExecutionProcessStep } from '@sync-think/protocol';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import { ExecutionProcessStepCard } from './ExecutionProcessBlock.js';
import { deferredContentReader } from './deferred-content-reader.js';

const detailsRef = {
  reference: { source: 'event-display' as const, id: 'large-event', path: ['payload'] },
  utf8Bytes: 1500000,
  utf16Length: 1500000,
  format: 'json' as const,
};
const step: ExecutionProcessStep = {
  id: 'custom-call',
  label: 'Custom',
  toolName: 'custom_tool',
  verb: 'Tool',
  zh: '自定义工具',
  kind: 'other',
  status: 'done',
  preview: 'ok',
  completedAt: '2026-09-05T19:00:00Z',
  detailsRef,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('oversized event detail reading', () => {
  it.each(['inline', 'card'])('assembles %s event details when the tool body opens', async (mode) => {
    const read = vi.spyOn(deferredContentReader, 'read').mockResolvedValue({
      content: {
        text: 'complete vendor detail',
        offset: 0,
        utf8Bytes: 22,
        utf16Length: 22,
        format: 'json',
        version: 'a'.repeat(64),
      },
    });
    if (mode === 'inline') {
      render(
        <InlineProcessFlow items={[]} steps={[step]} conversationId="conversation" defaultOpen />,
      );
      fireEvent.click(within(screen.getByTestId('inline-process-tool')).getByRole('button'));
    } else render(<ExecutionProcessStepCard step={step} autoOpen conversationId="conversation" />);
    await screen.findByText('complete vendor detail');
    expect(screen.queryByRole('button', { name: '读取完整内容' })).toBeNull();
    expect(read.mock.calls[0][0]).toMatchObject({
      conversationId: 'conversation',
      reference: detailsRef.reference,
    });
  });
});
