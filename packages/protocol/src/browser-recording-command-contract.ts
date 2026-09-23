import type {
  GetBrowserRecordingPayload,
  GetBrowserRecordingResponse,
  ListBrowserRecordingsPayload,
  ListBrowserRecordingsResponse,
  StartBrowserRecordingPayload,
  StartBrowserRecordingResponse,
  StopBrowserRecordingPayload,
  StopBrowserRecordingResponse,
  PauseBrowserRecordingPayload,
  PauseBrowserRecordingResponse,
  ResumeBrowserRecordingPayload,
  ResumeBrowserRecordingResponse,
} from './commands.js';

/** Browser Recording RPCs bind each command to its request and response payload. */
export interface BrowserRecordingCommandContract {
  'browser.recording.list': {
    request: ListBrowserRecordingsPayload;
    response: ListBrowserRecordingsResponse;
  };
  'browser.recording.get': {
    request: GetBrowserRecordingPayload;
    response: GetBrowserRecordingResponse;
  };
  'browser.recording.start': {
    request: StartBrowserRecordingPayload;
    response: StartBrowserRecordingResponse;
  };
  'browser.recording.stop': {
    request: StopBrowserRecordingPayload;
    response: StopBrowserRecordingResponse;
  };
  'browser.recording.pause': {
    request: PauseBrowserRecordingPayload;
    response: PauseBrowserRecordingResponse;
  };
  'browser.recording.resume': {
    request: ResumeBrowserRecordingPayload;
    response: ResumeBrowserRecordingResponse;
  };
}

export type BrowserRecordingCommand = keyof BrowserRecordingCommandContract;
export type BrowserRecordingCommandRequest<K extends BrowserRecordingCommand> =
  BrowserRecordingCommandContract[K]['request'];
export type BrowserRecordingCommandResponse<K extends BrowserRecordingCommand> =
  BrowserRecordingCommandContract[K]['response'];
