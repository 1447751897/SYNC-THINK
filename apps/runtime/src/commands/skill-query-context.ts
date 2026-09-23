import type { Socket } from 'node:net';
import type { Frame } from '@sync-think/protocol';
import type { SqliteCapabilityStore, SqliteMcpStore, SqliteSkillStore } from '@sync-think/storage';
import type { McpServerAuthSummaryInput } from '../mcp-server-summary.js';

/**
 * Narrow dependency surface for the read-only skill/mcp query handlers
 * (skill.get / skill.list / mcp.list). Assembled by Runtime from its own
 * private members; handlers never see the full Runtime instance.
 */
export interface SkillQueryContext {
  /** Skill capability store; undefined when runtime starts without storage. */
  skillStore?: SqliteSkillStore;
  /** Workspace activation resolver for ordinary Compose discovery. */
  capabilityStore?: SqliteCapabilityStore;
  /** MCP server metadata store; undefined when runtime starts without storage. */
  mcpStore?: SqliteMcpStore;
  /** Respond with PROTOCOL_FRAME_MALFORMED for an unparsable payload. */
  writeMalformedPayload(socket: Socket, frame: Frame): void;
  /** Respond with the skill-store-unavailable error frame. */
  writeSkillStoreUnavailable(socket: Socket, frame: Frame): void;
  /** Respond with the mcp-store-unavailable error frame. */
  writeMcpStoreUnavailable(socket: Socket, frame: Frame): void;
  /** Map a caught error onto the provider-command error frame. */
  writeProviderCommandError(socket: Socket, frame: Frame, error: unknown): void;
  /** Read the optional auth fact needed by the public MCP summary. */
  readMcpAuthConfig(mcpServerId: string): McpServerAuthSummaryInput | undefined;
}
