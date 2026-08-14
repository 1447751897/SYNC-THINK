import { describe, expect, it } from 'vitest';
import {
  createCodexLineBuffer,
  extractCodexErrorMessage,
  mapCodexApprovalPolicy,
  mapCodexSandbox,
  parseCodexEvent,
} from './codex-protocol.js';

describe('codex-protocol', () => {
  it('parses JSONL events and ignores blank / non-JSON lines', () => {
    expect(parseCodexEvent('{"type":"turn.started"}')).toEqual({ type: 'turn.started' });
    expect(parseCodexEvent('')).toBeNull();
    expect(parseCodexEvent('   ')).toBeNull();
    expect(parseCodexEvent('Reading additional input from stdin...')).toBeNull();
    expect(parseCodexEvent('{broken json')).toBeNull();
    // Objects without a string type field are not protocol events.
    expect(parseCodexEvent('{"foo":1}')).toBeNull();
  });

  it('buffers lines split across chunks', () => {
    const lines: string[] = [];
    const buffer = createCodexLineBuffer((line) => lines.push(line));
    buffer.push('{"type":"item.started","item":{"');
    buffer.push('id":"a"}}\n{"type":"turn');
    buffer.push('.completed"}\n');
    buffer.end();
    expect(lines).toEqual([
      '{"type":"item.started","item":{"id":"a"}}',
      '{"type":"turn.completed"}',
    ]);
  });

  it('maps host permission tiers to approval policy + sandbox', () => {
    expect(mapCodexApprovalPolicy('full-access')).toBe('never');
    expect(mapCodexApprovalPolicy('ask')).toBe('on-request');
    expect(mapCodexApprovalPolicy('workspace')).toBe('untrusted');
    expect(mapCodexSandbox('full-access')).toBe('danger-full-access');
    expect(mapCodexSandbox('ask')).toBe('workspace-write');
    expect(mapCodexSandbox('workspace')).toBe('workspace-write');
  });

  it('extracts nested JSON-wrapped error messages', () => {
    const apiError =
      '{"error":{"code":"unsupported_value","message":"Unsupported value: max","param":"reasoning.effort"}}';
    expect(extractCodexErrorMessage(apiError)).toBe('Unsupported value: max');
    expect(extractCodexErrorMessage({ message: apiError })).toBe('Unsupported value: max');
    expect(extractCodexErrorMessage({ error: { message: apiError } })).toBe(
      'Unsupported value: max',
    );
    expect(extractCodexErrorMessage('plain message')).toBe('plain message');
    expect(extractCodexErrorMessage(undefined)).toBeUndefined();
    expect(extractCodexErrorMessage(null)).toBeUndefined();
  });
});
