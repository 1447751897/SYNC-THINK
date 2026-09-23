import type {
  BrowserRecordingCommand,
  BrowserRecordingCommandRequest,
  BrowserRecordingCommandResponse,
} from '@sync-think/protocol';
import {
  parseGetBrowserRecordingPayload,
  parseListBrowserRecordingsPayload,
  parseStartBrowserRecordingPayload,
  parseStopBrowserRecordingPayload,
  parsePauseBrowserRecordingPayload,
  parseResumeBrowserRecordingPayload,
} from '../browser-recording-payloads.js';

export interface BrowserRecordingHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestBrowserRecording<K extends BrowserRecordingCommand>(
    command: K,
    payload: BrowserRecordingCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<BrowserRecordingCommandResponse<K>>;
}

export function registerBrowserRecordingHandlers<Event>(host: BrowserRecordingHost<Event>): void {
  host.handle('runtime:browser-recording-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserRecording(
      'browser.recording.list',
      parseListBrowserRecordingsPayload(value),
    );
  });

  host.handle('runtime:browser-recording-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserRecording(
      'browser.recording.get',
      parseGetBrowserRecordingPayload(value),
    );
  });

  host.handle('runtime:browser-recording-start', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserRecording(
      'browser.recording.start',
      parseStartBrowserRecordingPayload(value),
    );
  });

  host.handle('runtime:browser-recording-stop', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserRecording(
      'browser.recording.stop',
      parseStopBrowserRecordingPayload(value),
    );
  });

  host.handle('runtime:browser-recording-pause', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserRecording(
      'browser.recording.pause',
      parsePauseBrowserRecordingPayload(value),
    );
  });

  host.handle('runtime:browser-recording-resume', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestBrowserRecording(
      'browser.recording.resume',
      parseResumeBrowserRecordingPayload(value),
    );
  });
}
