import type {
  CancelBrowserHandoffPayload,
  CancelBrowserHandoffResponse,
  ContinueBrowserHandoffPayload,
  ContinueBrowserHandoffResponse,
  ListWaitingBrowserHandoffsPayload,
  ListWaitingBrowserHandoffsResponse,
} from './commands.js';

/** Browser Handoff RPCs bind each command to its request and response payload. */
export interface BrowserHandoffCommandContract {
  'browser.handoff.listWaiting': {
    request: ListWaitingBrowserHandoffsPayload;
    response: ListWaitingBrowserHandoffsResponse;
  };
  'browser.handoff.continue': {
    request: ContinueBrowserHandoffPayload;
    response: ContinueBrowserHandoffResponse;
  };
  'browser.handoff.cancel': {
    request: CancelBrowserHandoffPayload;
    response: CancelBrowserHandoffResponse;
  };
}

export type BrowserHandoffCommand = keyof BrowserHandoffCommandContract;
export type BrowserHandoffCommandRequest<K extends BrowserHandoffCommand> =
  BrowserHandoffCommandContract[K]['request'];
export type BrowserHandoffCommandResponse<K extends BrowserHandoffCommand> =
  BrowserHandoffCommandContract[K]['response'];
