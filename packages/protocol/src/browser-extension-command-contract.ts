export type BrowserExtensionConnectionState =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'version-mismatch'
  | 'authentication-failed'
  | 'protocol-mismatch';

export interface BrowserExtensionConnectionInfo {
  readonly bundledVersion: string;
  readonly url: string;
  readonly token: string;
}

export interface BrowserExtensionStatus {
  readonly state: BrowserExtensionConnectionState;
  readonly hostAvailable: boolean;
  readonly connected: boolean;
  readonly installedVersion: string | null;
  readonly versionMismatch: boolean;
  readonly busy: boolean;
  readonly lastErrorCode: string | null;
  readonly connectionInfo: BrowserExtensionConnectionInfo | null;
}

export interface BrowserExtensionOpenFolderResult {
  readonly success: boolean;
  readonly path?: string | null;
  readonly message?: string;
}

export type BrowserExtensionCommandPayload = Record<string, never>;

/** Browser Extension RPCs bind each command to its request and response payload. */
export interface BrowserExtensionCommandContract {
  'browser.extension.status': {
    request: BrowserExtensionCommandPayload;
    response: BrowserExtensionStatus;
  };
  'browser.extension.restart': {
    request: BrowserExtensionCommandPayload;
    response: BrowserExtensionStatus;
  };
  'browser.extension.resetPairing': {
    request: BrowserExtensionCommandPayload;
    response: BrowserExtensionStatus;
  };
  'browser.extension.openFolder': {
    request: BrowserExtensionCommandPayload;
    response: BrowserExtensionOpenFolderResult;
  };
}

export type BrowserExtensionCommand = keyof BrowserExtensionCommandContract;
export type BrowserExtensionCommandRequest<K extends BrowserExtensionCommand> =
  BrowserExtensionCommandContract[K]['request'];
export type BrowserExtensionCommandResponse<K extends BrowserExtensionCommand> =
  BrowserExtensionCommandContract[K]['response'];
