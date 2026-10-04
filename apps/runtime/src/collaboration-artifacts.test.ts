import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { CollaborationTask, CollaborationAttempt } from '@sync-think/shared';
import { submitCollaborationArtifact } from './collaboration-artifacts.js';
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) { if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw Error('test cleanup outside temp'); rmSync(path, { recursive: true, force: true }); } });
it('keeps the submitted file version after a later attempt overwrites its working path', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-version-')); directories.push(root);
  const task = { id: 't', kind: 'task', deliverable: { kind: 'file', title: '首章', path: 'chapter.md' } } as CollaborationTask;
  writeFileSync(join(root, 'chapter.md'), '第一稿');
  const first = submitCollaborationArtifact({ task, attempt: { id: 'a1' } as CollaborationAttempt, workspaceRoot: root });
  writeFileSync(join(root, 'chapter.md'), '第二稿');
  const second = submitCollaborationArtifact({ task, attempt: { id: 'a2' } as CollaborationAttempt, workspaceRoot: root, previousHash: first.sha256 });
  expect(first.storedPath).not.toBe(second.storedPath); expect(readFileSync(first.storedPath!, 'utf8')).toBe('第一稿');
  expect(readFileSync(second.storedPath!, 'utf8')).toBe('第二稿');
  expect(() => submitCollaborationArtifact({ task, attempt: { id: 'a3' } as CollaborationAttempt, workspaceRoot: root, previousHash: second.sha256 })).toThrow('artifact_unchanged');
});
it('rejects paths outside the room', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-version-')); directories.push(root);
  expect(() => submitCollaborationArtifact({ task: { id: 't', kind: 'task', deliverable: { kind: 'file', title: 'bad', path: '../escape.md' } } as CollaborationTask, attempt: { id: 'a' } as CollaborationAttempt, workspaceRoot: root })).toThrow();
});

it('persists document submissions as real immutable Markdown versions with exact Unicode metrics', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-document-')); directories.push(root);
  const task = { id: 't', kind: 'task', deliverable: { kind: 'document', title: '正文' } } as CollaborationTask;
  const first = submitCollaborationArtifact({ task, attempt: { id: 'a1' } as CollaborationAttempt, content: '  雨。\n😀 A  ', workspaceRoot: root });
  expect(first.path).toBeUndefined(); expect(first.storedPath).toMatch(/\.md$/);
  expect(readFileSync(first.storedPath!, 'utf8')).toBe('雨。\n😀 A');
  expect(first.textMetrics).toEqual({ characters: 6, charactersWithoutWhitespace: 4, scope: 'entire_text', punctuationIncluded: true });
  const second = submitCollaborationArtifact({ task, attempt: { id: 'a2' } as CollaborationAttempt, content: '后续稿', workspaceRoot: root });
  expect(first.storedPath).not.toBe(second.storedPath); expect(readFileSync(first.storedPath!, 'utf8')).toBe(first.content);
});
it('registers a document without inventing a local path when there is no bound workspace', () => {
  const artifact = submitCollaborationArtifact({ task: { id: 't', kind: 'task', deliverable: { kind: 'document', title: '正文' } } as CollaborationTask,
    attempt: { id: 'a' } as CollaborationAttempt, content: '真实文档' });
  expect(artifact.storedPath).toBeUndefined(); expect(artifact.textMetrics?.charactersWithoutWhitespace).toBe(4);
});
