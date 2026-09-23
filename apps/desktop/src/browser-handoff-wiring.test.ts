import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('./main/browser-handoff-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('./preload/index.ts', import.meta.url), 'utf8');

const handoffCommands = [
  {
    method: 'listWaitingBrowserHandoffs',
    channel: 'runtime:browser-handoff-list-waiting',
    command: 'browser.handoff.listWaiting',
    parser: 'parseListWaitingBrowserHandoffsPayload',
  },
  {
    method: 'continueBrowserHandoff',
    channel: 'runtime:browser-handoff-continue',
    command: 'browser.handoff.continue',
    parser: 'parseContinueBrowserHandoffPayload',
  },
  {
    method: 'cancelBrowserHandoff',
    channel: 'runtime:browser-handoff-cancel',
    command: 'browser.handoff.cancel',
    parser: 'parseCancelBrowserHandoffPayload',
  },
] as const;

describe('Desktop Browser handoff wiring', () => {
  it.each(handoffCommands)(
    'routes $channel through its strict parser to $command',
    ({ channel, command, parser }) => {
      expect(handlerSource).toMatch(
        new RegExp(
          `host\\.handle\\(\\s*'${escapeRegExp(channel)}'[\\s\\S]+?host\\.requestBrowserHandoff\\([\\s\\S]+?'${escapeRegExp(command)}'[\\s\\S]+?${parser}\\(value\\)`,
        ),
      );
    },
  );

  it.each(handoffCommands)('exposes $method through $channel', ({ method, channel }) => {
    expect(preloadSource).toMatch(
      new RegExp(
        `${method}:\\s*\\([^)]*\\)\\s*=>[\\s\\S]+?ipcRenderer\\.invoke\\([\\s\\S]+?'${escapeRegExp(channel)}'`,
      ),
    );
  });

  it('registers the Handoff boundary from the Main composition root', () => {
    expect(mainSource).toMatch(/registerBrowserHandoffHandlers\(\{/);
    expect(mainSource).toMatch(/getRuntimeClient\(\)\.requestBrowserHandoff/);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
