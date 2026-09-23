import type {
  ClearBrowserSiteSessionPayload,
  ClearBrowserSiteSessionResponse,
  CreateBrowserProfilePayload,
  CreateBrowserProfileResponse,
  DeleteBrowserProfilePayload,
  DeleteBrowserProfileResponse,
  ListBrowserProfilesPayload,
  ListBrowserProfilesResponse,
  ListBrowserSiteSessionsPayload,
  ListBrowserSiteSessionsResponse,
  RenameBrowserProfilePayload,
  RenameBrowserProfileResponse,
} from './commands.js';

/** Browser Profile RPCs bind each command to its request and response payload. */
export interface BrowserProfileCommandContract {
  'browser.profile.list': {
    request: ListBrowserProfilesPayload;
    response: ListBrowserProfilesResponse;
  };
  'browser.profile.create': {
    request: CreateBrowserProfilePayload;
    response: CreateBrowserProfileResponse;
  };
  'browser.profile.rename': {
    request: RenameBrowserProfilePayload;
    response: RenameBrowserProfileResponse;
  };
  'browser.profile.delete': {
    request: DeleteBrowserProfilePayload;
    response: DeleteBrowserProfileResponse;
  };
  'browser.profile.listSiteSessions': {
    request: ListBrowserSiteSessionsPayload;
    response: ListBrowserSiteSessionsResponse;
  };
  'browser.profile.clearSiteSession': {
    request: ClearBrowserSiteSessionPayload;
    response: ClearBrowserSiteSessionResponse;
  };
}

export type BrowserProfileCommand = keyof BrowserProfileCommandContract;
export type BrowserProfileCommandRequest<K extends BrowserProfileCommand> =
  BrowserProfileCommandContract[K]['request'];
export type BrowserProfileCommandResponse<K extends BrowserProfileCommand> =
  BrowserProfileCommandContract[K]['response'];
