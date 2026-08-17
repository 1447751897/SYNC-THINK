import { describe, expect, it } from 'vitest';
import type { KernelToolEventRecord } from '../src/demo-run.js';
import { externalKernelToolEventsToMessageBlocks } from '../src/runtime.js';

describe('externalKernelToolEventsToMessageBlocks', () => {
  it('converts tool-call and tool-result events into durable blocks in order', () => {
    const events: KernelToolEventRecord[] = [
      {
        kind: 'tool-call',
        sequence: 0,
        toolId: 'call-1',
        name: 'run_command',
        argsJson: '{"command":"echo hi"}',
      },
      {
        kind: 'tool-result',
        sequence: 1,
        toolId: 'call-1',
        output: 'hi',
      },
      {
        kind: 'tool-call',
        sequence: 2,
        toolId: 'call-2',
        name: 'write_file',
        argsJson: '{"path":"a.txt"}',
      },
      {
        kind: 'tool-result',
        sequence: 3,
        toolId: 'call-2',
        output: 'oops',
        failed: true,
      },
    ];

    const blocks = externalKernelToolEventsToMessageBlocks(events);
    expect(blocks).toEqual([
      { type: 'tool-call', payload: { name: 'run_command', argumentsJson: '{"command":"echo hi"}' } },
      { type: 'tool-result', text: 'hi' },
      { type: 'tool-call', payload: { name: 'write_file', argumentsJson: '{"path":"a.txt"}' } },
      { type: 'tool-result', text: 'oops', payload: { failed: true } },
    ]);
  });

  it('falls back to "unknown" tool name and empty arguments when missing', () => {
    const events: KernelToolEventRecord[] = [
      { kind: 'tool-call', sequence: 0, toolId: 'call-x' },
    ];
    const blocks = externalKernelToolEventsToMessageBlocks(events);
    expect(blocks).toEqual([
      { type: 'tool-call', payload: { name: 'unknown', argumentsJson: '' } },
    ]);
  });

  it('returns an empty array for empty or missing histories', () => {
    expect(externalKernelToolEventsToMessageBlocks(undefined)).toEqual([]);
    expect(externalKernelToolEventsToMessageBlocks([])).toEqual([]);
  });
});
