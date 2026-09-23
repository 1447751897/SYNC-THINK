import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/approval-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');

const approvalCommands = [
  ['listApprovals', 'runtime:approval-list', 'approval.list', 'parseListApprovalsPayload'],
  [
    'evaluateApproval',
    'runtime:approval-evaluate',
    'approval.evaluate',
    'parseEvaluateApprovalPayload',
  ],
  [
    'enqueueApproval',
    'runtime:approval-enqueue',
    'approval.enqueue',
    'parseEnqueueApprovalPayload',
  ],
  ['decideApproval', 'runtime:approval-decide', 'approval.decide', 'parseDecideApprovalPayload'],
] as const;

describe('Desktop Approval Center wiring', () => {
  it.each(approvalCommands)(
    'routes %s through its strict parser to %s',
    (method, channel, command, parser) => {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`host.requestApproval('${command}'`);
      expect(handlerSource).toContain(`${parser}(value)`);
      expect(preloadSource).toContain(`${method}:`);
      expect(preloadSource).toContain(`'${channel}'`);
    },
  );

  it('registers the Approval boundary from the Main composition root', () => {
    expect(mainSource).toContain('registerApprovalHandlers({');
    expect(mainSource).toContain('requestApproval:');
    expect(mainSource).not.toContain("request('approval.");
  });
});
