import { describe, expect, it } from 'vitest';
import type { ThreadId } from '@sync-think/shared';
import { buildComposeAppendRequest } from './compose-send-request.js';

const input: Parameters<typeof buildComposeAppendRequest>[0] = {
  threadId: 'thread' as ThreadId, taskVersion: 3, conversationId: 'conversation',
  text: 'Hello', images: [], track: 'model', targetRef: 'model-a', catalogModelIds: ['model-a'],
  modelOverride: '', kernelOverride: 'codex', reasoningEffort: 'high', networkEnabled: true, skillVersionIds: ['skill-v1'],
};

describe('compose append request', () => {
  it('preserves optimistic version and frozen model/kernel/skill choices', () => {
    expect(buildComposeAppendRequest(input)).toMatchObject({
      threadId: 'thread', expectedTaskVersion: 3, role: 'user', text: 'Hello', modelId: 'model-a',
      kernelId: 'codex', reasoningEffort: 'high', networkEnabled: true, skillVersionIds: ['skill-v1'],
    });
  });
  it.each(['agent', 'team'])('does not send the %s target as a model ID', (track) => {
    expect(buildComposeAppendRequest({ ...input, track, targetRef: 'agent-or-team-id' }).modelId)
      .toBeUndefined();
  });
  it('keeps image-only text fallback and workspace attachment context', () => {
    const images = [{ id: 'image', name: 'picture.png', url: 'data:image/png;base64,AA==' }];
    const request = buildComposeAppendRequest({ ...input, text: ' ', images, workspacePath: ' D:/workspace ' });
    expect(request).toMatchObject({
      text: '[图片] picture.png', attachmentContext: { conversationId: 'conversation', workspacePath: 'D:/workspace' },
      images: [{ id: 'image', name: 'picture.png', mimeType: 'image/png', dataUrl: images[0]!.url }],
    });
    expect(images[0]).not.toHaveProperty('mimeType');
  });
  it('omits inactive flags and image context while retaining exact selected skills', () => {
    const request = buildComposeAppendRequest({ ...input, networkEnabled: false, skillVersionIds: [], workspacePath: 'D:/workspace' });
    expect(request.networkEnabled).toBeUndefined();
    expect(request.images).toBeUndefined();
    expect(request.attachmentContext).toBeUndefined();
    expect(request.planExecuting).toBeUndefined();
    expect(request.helpMode).toBeUndefined();
    expect(request.skillVersionIds).toEqual([]);
    expect(buildComposeAppendRequest({ ...input, helpMode: true, planExecuting: true }))
      .toMatchObject({ helpMode: true, planExecuting: true });
  });
});
