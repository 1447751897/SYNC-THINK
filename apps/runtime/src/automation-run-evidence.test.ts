import { describe, expect, it } from 'vitest';
import { foldToolOutputText } from './chat-tools.js';
import {
  automationAcceptanceFailure,
  automationRecipientMatches,
  bindAutomationMailAttachments,
  projectBrowserWorkflowResultForModel,
  emptyAutomationEvidence,
  extractAutomationMailReceipt,
  isAutomationEvidence,
  type AutomationRunEvidence,
} from './automation-run-evidence.js';

const recipient = 'reports@example.com';
const delivery = {
  kind: 'gmail',
  mcpServerId: 'selected-connector',
  recipient,
  toolName: 'chosen_send_tool',
};
const file = (
  format: 'spreadsheet' | 'presentation',
): AutomationRunEvidence['outputs'][number] => ({
  format,
  path: format === 'spreadsheet' ? 'D:/fixtures/report.xlsx' : 'D:/fixtures/report.pptx',
  sha256: 'a'.repeat(64),
  bytes: 128,
});

// These tests observe the host-owned evidence boundary, not model prose or network sends.
describe('automation recipient binding', () => {
  it.each(['to', 'recipient', 'recipients', 'to_email', 'toEmail'])(
    'accepts a single matching %s with whitespace/case normalization',
    (key) => {
      expect(automationRecipientMatches({ [key]: '  REPORTS@example.com  ' }, recipient)).toBe(
        true,
      );
      expect(automationRecipientMatches({ [key]: [recipient] }, recipient)).toBe(true);
    },
  );

  it.each([
    {},
    { to: 'other@example.com' },
    { to: recipient + ',other@example.com' },
    { to: recipient + ';other@example.com' },
    { recipients: [recipient, 'other@example.com'] },
    { to: [] },
    { to: 1 },
  ])('rejects missing/mismatched/additional recipients: %j', (args) => {
    expect(automationRecipientMatches(args, recipient)).toBe(false);
  });

  it('requires every supplied recipient alias to agree', () => {
    expect(
      automationRecipientMatches({ to: recipient, recipient: 'other@example.com' }, recipient),
    ).toBe(false);
    expect(automationRecipientMatches({ to: recipient, recipient }, recipient)).toBe(true);
  });

  it.each(['cc', 'bcc'])('rejects %s expansion whether a string or array', (key) => {
    expect(
      automationRecipientMatches({ to: recipient, [key]: 'other@example.com' }, recipient),
    ).toBe(false);
    expect(
      automationRecipientMatches({ to: recipient, [key]: ['other@example.com'] }, recipient),
    ).toBe(false);
  });

  it('accepts explicitly empty cc/bcc without widening the selected recipient', () => {
    expect(automationRecipientMatches({ to: recipient, cc: '', bcc: [] }, recipient)).toBe(true);
  });
});

describe('structured connector receipt extraction', () => {
  it.each(['messageId', 'message_id', 'sentMessageId', 'receiptId'])(
    'accepts the structured %s identifier, not surrounding prose',
    (key) => {
      expect(extractAutomationMailReceipt(JSON.stringify({ [key]: '  sent-message-1  ' }))).toBe(
        'sent-message-1',
      );
    },
  );

  it('accepts Gmail native messages.send id plus threadId', () => {
    expect(
      extractAutomationMailReceipt({ id: 'gmail-message-1', threadId: 'gmail-thread-1' }),
    ).toBe('gmail-message-1');
  });

  it('reads an MCP content/text wrapper with a structured nested result', () => {
    expect(
      extractAutomationMailReceipt({
        content: [
          { type: 'text', text: JSON.stringify({ data: { messageId: 'nested-receipt' } }) },
        ],
      }),
    ).toBe('nested-receipt');
  });

  it.each([
    { ok: false, messageId: 'not-a-success' },
    { isError: true, result: { messageId: 'not-a-success' } },
    { error: 'rejected', data: { receiptId: 'not-a-success' } },
  ])('rejects an error envelope even if it contains an apparent receipt: %j', (result) => {
    expect(extractAutomationMailReceipt(result)).toBeUndefined();
  });

  it.each([
    '邮件已发送成功，附件已交付',
    { ok: true, status: 200 },
    { id: 'draft-1' },
    { messageId: '' },
    { messageId: '   ' },
    { messageId: 'x'.repeat(501) },
  ])('rejects prose/HTTP success/draft or invalid identifiers as send evidence: %j', (result) => {
    expect(extractAutomationMailReceipt(result)).toBeUndefined();
  });

  it.each([
    { id: '', threadId: 'thread-1' },
    { id: ' ', threadId: 'thread-1' },
    { id: 'message-1', threadId: '' },
  ])('requires nonempty native Gmail message/thread identifiers: %j', (result) => {
    expect(extractAutomationMailReceipt(result)).toBeUndefined();
  });
});

describe('host evidence and output acceptance', () => {
  it('returns independent empty evidence containers for separate runs', () => {
    const first = emptyAutomationEvidence();
    const second = emptyAutomationEvidence();
    first.outputs.push(file('spreadsheet'));
    expect(second).toEqual({ outputs: [] });
    expect(second).not.toHaveProperty('delivery');
  });

  it('accepts a typed output ledger and rejects malformed output records', () => {
    expect(isAutomationEvidence({ outputs: [file('spreadsheet'), file('presentation')] })).toBe(
      true,
    );
    expect(isAutomationEvidence({ outputs: 'report.xlsx' })).toBe(false);
    expect(isAutomationEvidence({ outputs: [{ ...file('spreadsheet'), format: 'pdf' }] })).toBe(
      false,
    );
    expect(isAutomationEvidence({ outputs: [{ ...file('spreadsheet'), bytes: Number.NaN }] })).toBe(
      false,
    );
  });

  it('keeps acceptance compatible for legacy tasks with no structured requirements', () => {
    expect(automationAcceptanceFailure({}, emptyAutomationEvidence())).toBeUndefined();
  });

  it('requires successful workflow evidence only when a workflow is explicitly bound', () => {
    expect(
      automationAcceptanceFailure(
        { browser: { workflowTaskId: 'workflow-1' } },
        emptyAutomationEvidence(),
      ),
    ).toMatch(/浏览器流程/);
    expect(automationAcceptanceFailure({ browser: {} }, emptyAutomationEvidence())).toBeUndefined();
    expect(
      automationAcceptanceFailure(
        { browser: { workflowTaskId: 'workflow-1' } },
        { outputs: [], browserWorkflowCompleted: true },
      ),
    ).toBeUndefined();
  });

  it('requires each requested output format rather than substituting a spreadsheet for a presentation', () => {
    const config = {
      outputs: ['spreadsheet', 'presentation'] as Array<'spreadsheet' | 'presentation'>,
    };
    expect(automationAcceptanceFailure(config, { outputs: [file('spreadsheet')] })).toMatch(
      /presentation/,
    );
    expect(
      automationAcceptanceFailure(config, { outputs: [file('spreadsheet'), file('presentation')] }),
    ).toBeUndefined();
  });

  it.each([0, -1])(
    'rejects %s-byte output evidence instead of reporting a real file delivery',
    (bytes) => {
      expect(
        automationAcceptanceFailure(
          { outputs: ['spreadsheet'] },
          { outputs: [{ ...file('spreadsheet'), bytes }] },
        ),
      ).toMatch(/spreadsheet/);
    },
  );

  it('rejects missing mail evidence instead of accepting an instruction or claimed success', () => {
    expect(automationAcceptanceFailure({ delivery }, emptyAutomationEvidence())).toMatch(
      /邮件发送回执/,
    );
  });

  it('accepts delivery only with a sent state and host-owned structured receipt', () => {
    expect(
      automationAcceptanceFailure(
        { delivery },
        {
          outputs: [],
          delivery: { state: 'sent', receiptId: 'sent-message-1', toolCallId: 'call-1' },
        },
      ),
    ).toBeUndefined();
  });

  it('rejects a sent label without a receipt rather than treating that label as proof', () => {
    expect(
      automationAcceptanceFailure(
        { delivery },
        { outputs: [], delivery: { state: 'sent', toolCallId: 'call-1' } },
      ),
    ).toBeTypeOf('string');
  });

  it.each(['sending', 'unknown'] as const)(
    'halts automatic resending after %s and preserves the unresolved attempt across checks',
    (state) => {
      const evidence: AutomationRunEvidence = {
        browserWorkflowCompleted: true,
        outputs: [file('spreadsheet'), file('presentation')],
        delivery: { state, toolCallId: 'original-mail-attempt' },
      };
      const config = {
        browser: { workflowTaskId: 'workflow-1' },
        outputs: ['spreadsheet', 'presentation'] as Array<'spreadsheet' | 'presentation'>,
        delivery,
      };
      const before = structuredClone(evidence);
      expect(automationAcceptanceFailure(config, evidence)).toMatch(/停止自动重发/);
      expect(automationAcceptanceFailure(config, evidence)).toMatch(/停止自动重发/);
      expect(evidence).toEqual(before);
    },
  );
});

describe('Chrome workflow model projection regression', () => {
  const largeSteps = () =>
    Array.from({ length: 10 }, (_, index) => ({
      sequence: index + 1,
      ok: true,
      actionKind: index === 0 ? 'open' : 'click',
      outputUrl: 'https://workflow.fixture.test/page/' + (index + 1),
      screenshotRelativePath: 'browser-runs/run-1/step-' + (index + 1) + '.png',
      screenshotEmbedUrl:
        'https://screenshots.fixture.test/step-' + (index + 1) + '?image=' + 'A'.repeat(80_000),
    }));

  it('keeps a 10-step large-screenshot result parseable for the model while leaving full raw trace intact', () => {
    const full = {
      ok: true,
      runId: 'chrome-run-1',
      workflowVersionId: 'workflow-version-1',
      taskId: 'browser-task-1',
      profileId: 'profile-1',
      stepCount: 10,
      executedStepCount: 10,
      steps: largeSteps(),
    };
    const raw = JSON.stringify(full);
    const oldFold = foldToolOutputText(raw);
    expect(oldFold.folded).toBe(true);
    expect(() => JSON.parse(oldFold.text)).toThrow();
    const projected = projectBrowserWorkflowResultForModel(raw);
    expect(foldToolOutputText(projected).folded).toBe(false);
    const model = JSON.parse(projected);
    expect(model).toMatchObject({
      ok: true,
      runId: 'chrome-run-1',
      workflowVersionId: 'workflow-version-1',
      taskId: 'browser-task-1',
      profileId: 'profile-1',
      stepCount: 10,
      executedStepCount: 10,
      traceStepCount: 10,
    });
    expect(model.steps).toEqual(
      [8, 9, 10].map((sequence) => ({
        sequence,
        ok: true,
        actionKind: 'click',
        outputUrl: 'https://workflow.fixture.test/page/' + sequence,
      })),
    );
    expect(projected).not.toContain('screenshotEmbedUrl');
    expect(projected).not.toContain('A'.repeat(100));
    expect(JSON.parse(raw)).toEqual(full);
    expect(JSON.parse(raw).steps).toHaveLength(10);
    expect(JSON.parse(raw).steps[0].screenshotEmbedUrl).toHaveLength(
      full.steps[0].screenshotEmbedUrl.length,
    );
  });

  it('preserves failed execution code, counts and final-step diagnostic rather than folding into invalid JSON', () => {
    const steps = largeSteps();
    const failure = {
      ...steps[9],
      ok: false,
      error: 'Required confirmation button was not found.',
    };
    const raw = JSON.stringify({
      ok: false,
      runId: 'chrome-run-failed',
      taskId: 'browser-task-1',
      profileId: 'profile-1',
      stepCount: 10,
      executedStepCount: 9,
      code: 'browser.workflow-step-failed',
      failureClass: 'selector-missing',
      error: failure.error,
      steps: [...steps.slice(0, 9), failure],
    });
    const projected = projectBrowserWorkflowResultForModel(raw);
    expect(foldToolOutputText(projected).folded).toBe(false);
    const model = JSON.parse(projected);
    expect(model).toMatchObject({
      ok: false,
      runId: 'chrome-run-failed',
      code: 'browser.workflow-step-failed',
      failureClass: 'selector-missing',
      error: failure.error,
      stepCount: 10,
      executedStepCount: 9,
      traceStepCount: 10,
    });
    expect(model.steps[2]).toMatchObject({ sequence: 10, ok: false, error: failure.error });
    expect(model.steps[2]).not.toHaveProperty('screenshotEmbedUrl');
    expect(JSON.parse(raw).steps[9].screenshotEmbedUrl).toBe(failure.screenshotEmbedUrl);
  });

  it('keeps permission-blocked code, missingOrigins and askUser without inventing workflow success', () => {
    const full = {
      ok: false,
      taskId: 'browser-task-1',
      profileId: 'profile-1',
      stepCount: 0,
      executedStepCount: 0,
      code: 'browser.workflow-origin-grant-required',
      failureClass: 'permission',
      error: 'This Workflow needs approval to navigate to the selected origins.',
      missingOrigins: ['https://reports.fixture.test', 'https://accounts.fixture.test'],
      askUser: true,
      steps: [],
    };
    const projected = projectBrowserWorkflowResultForModel(JSON.stringify(full));
    const model = JSON.parse(projected);
    expect(model).toMatchObject(full);
    expect(model.ok).toBe(false);
    expect(model.missingOrigins).toEqual(full.missingOrigins);
    expect(foldToolOutputText(projected).folded).toBe(false);
  });
});

const generatedAttachments = [
  {
    path: 'D:/fixtures/report.xlsx',
    fileName: 'report.xlsx',
    base64: 'c3ByZWFkc2hlZXQtYnl0ZXM=',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    path: 'D:/fixtures/report.pptx',
    fileName: 'report.pptx',
    base64: 'cHJlc2VudGF0aW9uLWJ5dGVz',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
];
const attachmentArgs = {
  to: recipient,
  subject: 'Daily report',
  body: 'Attached reports from the selected workflow.',
};

describe('explicit connector attachment schema adapters', () => {
  it('binds attachmentPaths string arrays from host-owned paths, replacing conflicting provider attachments', () => {
    const schema = {
      type: 'object',
      properties: { attachmentPaths: { type: 'array', items: { type: 'string' } } },
    };
    const args = { ...attachmentArgs, attachments: ['provider-invented-file'] };
    const before = structuredClone(args);
    expect(bindAutomationMailAttachments(schema, args, generatedAttachments)).toEqual({
      ...attachmentArgs,
      attachmentPaths: ['D:/fixtures/report.xlsx', 'D:/fixtures/report.pptx'],
    });
    expect(args).toEqual(before);
  });

  it('binds attachments string arrays to real paths, not generated base64', () => {
    const schema = {
      type: 'object',
      properties: { attachments: { type: 'array', items: { type: 'string' } } },
    };
    expect(
      bindAutomationMailAttachments(
        schema,
        { ...attachmentArgs, attachmentPaths: ['provider-invented-path'] },
        generatedAttachments,
      ),
    ).toEqual({
      ...attachmentArgs,
      attachments: ['D:/fixtures/report.xlsx', 'D:/fixtures/report.pptx'],
    });
  });

  it('binds object contentBase64/filename/mimeType/encoding without mutating host files or caller args', () => {
    const schema = {
      type: 'object',
      properties: {
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              contentBase64: { type: 'string' },
              filename: { type: 'string' },
              mimeType: { type: 'string' },
              encoding: { type: 'string' },
            },
          },
        },
      },
    };
    const filesBefore = structuredClone(generatedAttachments);
    const argsBefore = structuredClone(attachmentArgs);
    expect(bindAutomationMailAttachments(schema, attachmentArgs, generatedAttachments)).toEqual({
      ...attachmentArgs,
      attachments: [
        {
          contentBase64: 'c3ByZWFkc2hlZXQtYnl0ZXM=',
          filename: 'report.xlsx',
          mimeType: generatedAttachments[0].mimeType,
          encoding: 'base64',
        },
        {
          contentBase64: 'cHJlc2VudGF0aW9uLWJ5dGVz',
          filename: 'report.pptx',
          mimeType: generatedAttachments[1].mimeType,
          encoding: 'base64',
        },
      ],
    });
    expect(generatedAttachments).toEqual(filesBefore);
    expect(attachmentArgs).toEqual(argsBefore);
  });

  it.each(['content', 'data'])(
    'adapts declared object %s content fields and connector-specific metadata aliases',
    (contentKey) => {
      const schema = {
        properties: {
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                [contentKey]: { type: 'string' },
                fileName: { type: 'string' },
                name: { type: 'string' },
                contentType: { type: 'string' },
              },
            },
          },
        },
      };
      expect(
        bindAutomationMailAttachments(schema, attachmentArgs, [generatedAttachments[0]]),
      ).toEqual({
        ...attachmentArgs,
        attachments: [
          {
            [contentKey]: 'c3ByZWFkc2hlZXQtYnl0ZXM=',
            fileName: 'report.xlsx',
            name: 'report.xlsx',
            contentType: generatedAttachments[0].mimeType,
          },
        ],
      });
    },
  );

  it.each(['path', 'filePath'])(
    'uses declared object %s path fields without adding undeclared binary content',
    (pathKey) => {
      const schema = {
        properties: {
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                [pathKey]: { type: 'string' },
                filename: { type: 'string' },
              },
            },
          },
        },
      };
      expect(
        bindAutomationMailAttachments(schema, attachmentArgs, [generatedAttachments[0]]),
      ).toEqual({
        ...attachmentArgs,
        attachments: [{ [pathKey]: 'D:/fixtures/report.xlsx', filename: 'report.xlsx' }],
      });
    },
  );

  it.each([
    undefined,
    {},
    { properties: { attachments: { type: 'string' } } },
    { properties: { attachments: { type: 'array' } } },
    {
      properties: {
        attachments: {
          type: 'array',
          items: { type: 'object', properties: { url: { type: 'string' } } },
        },
      },
    },
    { properties: { customFiles: { type: 'array', items: { type: 'string' } } } },
  ])(
    'rejects unknown attachment schema instead of guessing fields or returning unbound args: %j',
    (schema) => {
      expect(
        bindAutomationMailAttachments(schema, attachmentArgs, generatedAttachments),
      ).toBeUndefined();
    },
  );
});
