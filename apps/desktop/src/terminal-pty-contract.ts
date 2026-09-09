export interface CreatePtyRequest {
  sessionId?: string;
  workspaceId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
  colorScheme?: 'dark' | 'light' | string;
}

export type CreatePtyResult =
  | { success: true; sessionId: string; created: boolean }
  | { success: false; error?: string };

export interface PtySessionInfo {
  id: string;
  workspaceId: string;
  title: string;
  cwd: string;
  createdAt: string;
  lastActiveAt: string;
  alive: boolean;
}

export interface PtyTerminalBridge {
  create(params: CreatePtyRequest): Promise<CreatePtyResult>;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): Promise<void>;
  exists(sessionId: string): Promise<boolean>;
  list(): Promise<PtySessionInfo[]>;
  getBuffer(sessionId: string): Promise<string>;
  onData(listener: (sessionId: string, data: string) => void): () => void;
  onExit(listener: (sessionId: string, exitCode: number) => void): () => void;
}
