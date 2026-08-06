import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('./preload/index.ts', import.meta.url), 'utf8');

const workflowCommands = [
  {
    method: 'list',
    channel: 'runtime:browser-workflow-list',
    command: 'browser.workflow.list',
    parser: 'parseListBrowserWorkflowsPayload',
  },
  {
    method: 'get',
    channel: 'runtime:browser-workflow-get',
    command: 'browser.workflow.get',
    parser: 'parseGetBrowserWorkflowPayload',
  },
  {
    method: 'createDraft',
    channel: 'runtime:browser-workflow-create-draft',
    command: 'browser.workflow.createDraft',
    parser: 'parseCreateBrowserWorkflowDraftPayload',
  },
  {
    method: 'createRevisionDraft',
    channel: 'runtime:browser-workflow-create-revision-draft',
    command: 'browser.workflow.createRevisionDraft',
    parser: 'parseCreateBrowserWorkflowRevisionDraftPayload',
  },
  {
    method: 'submit',
    channel: 'runtime:browser-workflow-submit',
    command: 'browser.workflow.submit',
    parser: 'parseSubmitBrowserWorkflowDraftPayload',
  },
  {
    method: 'review',
    channel: 'runtime:browser-workflow-review',
    command: 'browser.workflow.review',
    parser: 'parseReviewBrowserWorkflowDraftPayload',
  },
] as const;

describe('Desktop Browser workflow wiring', () => {
  it.each(workflowCommands)(
    'routes $channel through its strict parser to $command',
    ({ channel, command, parser }) => {
      expect(mainSource).toMatch(
        new RegExp(
          `ipcMain\\.handle\\(\\s*'${escapeRegExp(channel)}'[\\s\\S]+?getRuntimeClient\\(\\)\\.request\\([\\s\\S]+?'${escapeRegExp(command)}'[\\s\\S]+?${parser}\\(value\\)`,
        ),
      );
    },
  );

  it.each(workflowCommands)(
    'exposes browserWorkflow.$method through $channel',
    ({ method, channel }) => {
      expect(preloadSource).toMatch(
        new RegExp(
          `browserWorkflow:\\s*\\{[\\s\\S]+?${method}:\\s*\\([^)]*\\)\\s*=>[\\s\\S]+?ipcRenderer\\.invoke\\([\\s\\S]+?'${escapeRegExp(channel)}'`,
        ),
      );
    },
  );
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
