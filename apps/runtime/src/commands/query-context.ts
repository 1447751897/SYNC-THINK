import type { Socket } from 'node:net';
import type { Frame } from '@sync-think/protocol';
import type { SqliteWorkspaceStore } from '@sync-think/storage';

/**
 * Narrow dependency surface for read-only query command handlers.
 *
 * Handlers extracted out of the Runtime class receive this context instead of
 * the full Runtime instance, which keeps their real dependencies explicit and
 * the coupling to Runtime internals minimal.
 */
export interface QueryContext {
  /** Workspace-scoped persistence store (optional on unconfigured Runtimes). */
  readonly workspaceStore?: SqliteWorkspaceStore;
  /** Write a PROTOCOL_FRAME_MALFORMED error response for the given frame. */
  writeMalformedPayload(socket: Socket, frame: Frame): void;
  /** Write a STORAGE_WRITE_FAILED error response when the workspace store is absent. */
  writeWorkspaceStoreUnavailable(socket: Socket, frame: Frame): void;
  /** Map a workspace-domain error to the canonical error response. */
  writeWorkspaceCommandError(socket: Socket, frame: Frame, error: unknown): void;
}
