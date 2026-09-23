import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('./main/browser-recording-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('./preload/index.ts', import.meta.url), 'utf8');

const recordingCommands = [
  {
    method: 'list',
    channel: 'runtime:browser-recording-list',
    command: 'browser.recording.list',
    parser: 'parseListBrowserRecordingsPayload',
  },
  {
    method: 'get',
    channel: 'runtime:browser-recording-get',
    command: 'browser.recording.get',
    parser: 'parseGetBrowserRecordingPayload',
  },
  {
    method: 'start',
    channel: 'runtime:browser-recording-start',
    command: 'browser.recording.start',
    parser: 'parseStartBrowserRecordingPayload',
  },
  {
    method: 'stop',
    channel: 'runtime:browser-recording-stop',
    command: 'browser.recording.stop',
    parser: 'parseStopBrowserRecordingPayload',
  },
] as const;

describe('Desktop Browser recording wiring', () => {
  it.each(recordingCommands)(
    'routes $channel through its strict parser to $command',
    ({ channel, command, parser }) => {
      expect(handlerSource).toMatch(
        new RegExp(
          `host\\.handle\\('${escapeRegExp(channel)}'[\\s\\S]+?host\\.requestBrowserRecording\\([\\s\\S]+?'${escapeRegExp(command)}'[\\s\\S]+?${parser}\\(value\\)`,
        ),
      );
    },
  );

  it.each(recordingCommands)(
    'exposes browserRecording.$method through $channel',
    ({ method, channel }) => {
      expect(preloadSource).toMatch(
        new RegExp(
          `browserRecording:\\s*\\{[\\s\\S]+?${method}:\\s*\\([^)]*\\)\\s*=>[\\s\\S]+?ipcRenderer\\.invoke\\([\\s\\S]+?'${escapeRegExp(channel)}'`,
        ),
      );
    },
  );

  it('registers the Recording boundary from the Main composition root', () => {
    expect(mainSource).toMatch(/registerBrowserRecordingHandlers\(\{/);
    expect(mainSource).toMatch(/getRuntimeClient\(\)\.requestBrowserRecording/);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
