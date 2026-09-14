import { describe, expect, it } from 'vitest';
import { avatarStateFrom } from './agentAvatarState.js';

describe('avatarStateFrom', () => {
  it('defaults to idle when nothing is happening', () => {
    expect(avatarStateFrom({})).toBe('idle');
    expect(avatarStateFrom({ streaming: false, failed: false })).toBe('idle');
  });

  it('reports archived as inactive above everything else', () => {
    expect(
      avatarStateFrom({ archived: true, failed: true, streaming: true, awaitingApproval: true }),
    ).toBe('inactive');
  });

  it('surfaces a failure over a still-running turn', () => {
    expect(avatarStateFrom({ failed: true, streaming: true, reasoning: true })).toBe('error');
  });

  it('surfaces a pending approval over streaming', () => {
    expect(avatarStateFrom({ awaitingApproval: true, streaming: true })).toBe('waiting');
    expect(avatarStateFrom({ awaitingApproval: true, justCompleted: true })).toBe('waiting');
  });

  it('prefers reasoning over plain streaming', () => {
    expect(avatarStateFrom({ reasoning: true, streaming: true })).toBe('thinking');
  });

  it('lets a running turn override the completion celebration', () => {
    expect(avatarStateFrom({ justCompleted: true, streaming: true })).toBe('working');
    expect(avatarStateFrom({ justCompleted: true })).toBe('happy');
  });

  it('keeps the not-yet-wired states reachable', () => {
    expect(avatarStateFrom({ unread: true })).toBe('looking');
    expect(avatarStateFrom({ idleLong: true })).toBe('sleeping');
    expect(avatarStateFrom({ unread: true, idleLong: true })).toBe('looking');
  });
});
