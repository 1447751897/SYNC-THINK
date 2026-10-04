import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCollaborationCommand } from '@sync-think/protocol';
import type { CollaborationCommand, CollaborationMessage } from '@sync-think/shared';
import { prepareCollaborationAttachments } from './collaboration-attachments.js';
import { collaborationMessageContextText, collaborationMessageImages } from './collaboration-attachment-context.js';
import { resolveAppendMessageImageDataUrl } from './chat-image-staging.js';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'group-attachments-'))); directories.push(directory);
  const root = join(directory, 'project'); mkdirSync(root);
  const source = join(directory, 'song.mp3'); writeFileSync(source, 'real audio fixture');
  return { directory, root, source };
}
const send = { action: 'send', conversationId: 'room-1', clientRequestId: 'send-1', text: '' } as const;
const image = { id: 'image-1', name: 'cover.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
describe('group attachment ingestion', () => {
  it('accepts image-only and audio-only messages, but rejects malformed or excessive attachments', () => {
    expect(parseCollaborationCommand({ ...send, images: [image] })).toBeTruthy();
    expect(parseCollaborationCommand({ ...send, files: [{ path: 'assets/song.mp3', name: 'song.mp3' }] })).toBeTruthy();
    expect(parseCollaborationCommand(send)).toBeUndefined();
    expect(parseCollaborationCommand({ ...send, images: [{ ...image, mimeType: 'text/html' }] })).toBeUndefined();
    expect(parseCollaborationCommand({ ...send, images: Array(9).fill(image) })).toBeUndefined();
    expect(parseCollaborationCommand({ ...send, files: [{ path: 'x', name: 'x', sizeBytes: 51 * 1024 * 1024 }] })).toBeUndefined();
  });
  it('imports selected audio bytes into the bound project and keeps project references in place', () => {
    const f = fixture();
    const prepared = prepareCollaborationAttachments({ ...send, files: [{ path: f.source, name: 'song.mp3', mimeType: 'audio/mpeg' }] }, f.root);
    const file = prepared.files![0];
    expect(file.path).toContain('.sync-think/conversations/room-1/files/');
    expect(file.sourcePath).toBe(f.source);
    expect(readFileSync(join(f.root, file.path), 'utf8')).toBe('real audio fixture');
    const existing = prepareCollaborationAttachments({ ...send, files: [{ path: file.path, name: 'song.mp3' }] }, f.root);
    expect(existing.files![0].path).toBe(file.path);
  });
  it('persists image bytes without base64 in snapshots and produces a trusted multimodal path', () => {
    const f = fixture();
    const prepared = prepareCollaborationAttachments({ ...send, images: [image] }, f.root);
    expect(prepared.images![0].dataUrl).toBeUndefined();
    expect(resolveAppendMessageImageDataUrl(prepared.images![0], { workspaceRoot: f.root, conversationId: send.conversationId })).toBe(image.dataUrl);
    const message = { blocks: [{ type: 'image', payload: prepared.images![0] }, { type: 'file', payload: { name: 'song.mp3', path: 'assets/song.mp3' } }] } as CollaborationMessage;
    expect(collaborationMessageImages([message])).toEqual(prepared.images);
    expect(collaborationMessageContextText(message)).toContain('assets/song.mp3');
    expect(collaborationMessageContextText(message)).not.toContain('base64');
  });
  it('rejects files without an effective workspace and external directory uploads', () => {
    const f = fixture();
    const command: Extract<CollaborationCommand, { action: 'send' }> = { ...send, files: [{ path: f.source, name: 'song.mp3' }] };
    expect(() => prepareCollaborationAttachments(command, undefined)).toThrow('attachment_workspace_required');
    expect(() => prepareCollaborationAttachments({ ...send, files: [{ path: f.directory, name: 'external', kind: 'dir' }] }, f.root)).toThrow('attachment_directory_outside_workspace');
  });
});
