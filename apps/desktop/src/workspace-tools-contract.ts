export interface SearchProjectContentPayload {
  root: string;
  query: string;
  maxResults?: number;
}

export interface ProjectContentMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchText: string;
}

export interface SearchProjectContentResult {
  engine: 'rg' | 'fallback';
  results: ProjectContentMatch[];
  truncated: boolean;
  timedOut: boolean;
}

export interface ProjectTextLocation {
  line: number;
  column: number;
}

export interface StartProjectTerminalPayload {
  root: string;
  terminalId: string;
  commandLine: string;
  cwd: string;
}

export interface StartProjectTerminalResult {
  terminalId: string;
  commandId: string;
  cwd: string;
  state: 'running' | 'completed';
}

export interface CancelProjectTerminalPayload {
  terminalId: string;
  commandId: string;
}

export interface CancelProjectTerminalResult {
  cancelled: boolean;
}

export type ProjectTerminalEvent =
  | {
      terminalId: string;
      commandId: string;
      type: 'stdout' | 'stderr';
      text: string;
    }
  | {
      terminalId: string;
      commandId: string;
      type: 'completed';
      exitCode: number | null;
      truncated: boolean;
      cwd: string;
    }
  | {
      terminalId: string;
      commandId: string;
      type: 'cancelled';
      cwd: string;
    }
  | {
      terminalId: string;
      commandId: string;
      type: 'failed';
      failureClass: 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';
      code: string;
      message: string;
      cwd: string;
    };
