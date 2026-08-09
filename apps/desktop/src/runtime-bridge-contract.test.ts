import { describe, expect, it } from 'vitest';
import { CAPABILITY_RUNTIME_IPC_CHANNELS } from './runtime-bridge-contract.js';

describe('capability runtime IPC contract', () => {
  it('keeps all capability bridge channels unique and runtime-scoped', () => {
    const channels = Object.values(CAPABILITY_RUNTIME_IPC_CHANNELS);
    expect(new Set(channels).size).toBe(channels.length);
    expect(channels).toHaveLength(9);
    for (const channel of channels) {
      expect(channel.startsWith('runtime:capability-')).toBe(true);
    }
  });
});
