import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROFILE_MAINTENANCE_REQUEST_TIMEOUT_MS,
  BROWSER_RECORDING_REQUEST_TIMEOUT_MS,
  BROWSER_WORKFLOW_REPLAY_REQUEST_TIMEOUT_MS,
  MCP_REMOTE_REQUEST_TIMEOUT_MS,
  PROMPT_ENHANCEMENT_REQUEST_TIMEOUT_MS,
  USAGE_SUMMARY_REQUEST_TIMEOUT_MS,
  resolveRuntimeRequestTimeoutMs,
} from './runtime-client.js';

describe('RuntimePipeClient request timeout policy', () => {
  it('gives usage summary enough time for a first-time background cache build', () => {
    expect(resolveRuntimeRequestTimeoutMs('usage.summary', 5_000)).toBe(
      USAGE_SUMMARY_REQUEST_TIMEOUT_MS,
    );
    expect(resolveRuntimeRequestTimeoutMs('runtime.healthcheck', 5_000)).toBe(5_000);
  });

  it('keeps the prompt enhancement provider call open beyond the CRUD budget', () => {
    expect(resolveRuntimeRequestTimeoutMs('prompt.enhance', 5_000)).toBe(
      PROMPT_ENHANCEMENT_REQUEST_TIMEOUT_MS,
    );
    expect(PROMPT_ENHANCEMENT_REQUEST_TIMEOUT_MS).toBeGreaterThan(5_000);
  });

  it('allows cold Browser Profile inspection and maintenance to finish', () => {
    for (const type of [
      'browser.profile.listSiteSessions',
      'browser.profile.clearSiteSession',
      'browser.profile.delete',
    ]) {
      expect(resolveRuntimeRequestTimeoutMs(type, 5_000)).toBe(
        BROWSER_PROFILE_MAINTENANCE_REQUEST_TIMEOUT_MS,
      );
    }
    expect(resolveRuntimeRequestTimeoutMs('browser.profile.list', 5_000)).toBe(5_000);
  });

  it('allows Browser recording lifecycle operations to open and close a system browser', () => {
    for (const type of ['browser.recording.start', 'browser.recording.stop']) {
      expect(resolveRuntimeRequestTimeoutMs(type, 5_000)).toBe(
        BROWSER_RECORDING_REQUEST_TIMEOUT_MS,
      );
    }
    expect(resolveRuntimeRequestTimeoutMs('browser.recording.list', 5_000)).toBe(5_000);
    expect(resolveRuntimeRequestTimeoutMs('browser.recording.get', 5_000)).toBe(5_000);
  });

  it('gives Workflow replay enough time to open the browser and run every step', () => {
    for (const type of ['browser.workflow.execute', 'browser.workflow.approveAndExecute']) {
      expect(resolveRuntimeRequestTimeoutMs(type, 5_000)).toBe(
        BROWSER_WORKFLOW_REPLAY_REQUEST_TIMEOUT_MS,
      );
    }
    expect(resolveRuntimeRequestTimeoutMs('browser.workflow.list', 5_000)).toBe(5_000);
    expect(resolveRuntimeRequestTimeoutMs('browser.workflow.get', 5_000)).toBe(5_000);
  });

  it('keeps Desktop IPC alive for the complete remote MCP handshake', () => {
    for (const type of ['mcp.registerRemote', 'mcp.tools.refresh', 'mcp.tool.call']) {
      expect(resolveRuntimeRequestTimeoutMs(type, 5_000)).toBe(MCP_REMOTE_REQUEST_TIMEOUT_MS);
    }
    expect(MCP_REMOTE_REQUEST_TIMEOUT_MS).toBeGreaterThan(120_000);
  });
});
