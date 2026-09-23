import type {
  GetBrowserRecordingPayload,
  ListBrowserRecordingsPayload,
  StartBrowserRecordingPayload,
  StopBrowserRecordingPayload,
  PauseBrowserRecordingPayload,
  ResumeBrowserRecordingPayload,
} from '@sync-think/protocol';
import {
  tryParseGetBrowserRecordingPayload,
  tryParseListBrowserRecordingsPayload,
  tryParseStartBrowserRecordingPayload,
  tryParseStopBrowserRecordingPayload,
  tryParsePauseBrowserRecordingPayload,
  tryParseResumeBrowserRecordingPayload,
} from '@sync-think/protocol/browser-payloads';

function requirePayload<T>(command: string, payload: T | undefined): T {
  if (payload === undefined) throw new Error(`Invalid ${command} payload`);
  return payload;
}

export function parseListBrowserRecordingsPayload(value: unknown): ListBrowserRecordingsPayload {
  return requirePayload('list-browser-recordings', tryParseListBrowserRecordingsPayload(value));
}

export function parseGetBrowserRecordingPayload(value: unknown): GetBrowserRecordingPayload {
  return requirePayload('get-browser-recording', tryParseGetBrowserRecordingPayload(value));
}

export function parseStartBrowserRecordingPayload(value: unknown): StartBrowserRecordingPayload {
  return requirePayload('start-browser-recording', tryParseStartBrowserRecordingPayload(value));
}

export function parseStopBrowserRecordingPayload(value: unknown): StopBrowserRecordingPayload {
  return requirePayload('stop-browser-recording', tryParseStopBrowserRecordingPayload(value));
}

export function parsePauseBrowserRecordingPayload(value: unknown): PauseBrowserRecordingPayload {
  return requirePayload('pause-browser-recording', tryParsePauseBrowserRecordingPayload(value));
}

export function parseResumeBrowserRecordingPayload(value: unknown): ResumeBrowserRecordingPayload {
  return requirePayload('resume-browser-recording', tryParseResumeBrowserRecordingPayload(value));
}
