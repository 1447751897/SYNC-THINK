import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CollaborationArtifact, CollaborationAttempt, CollaborationTask } from '@sync-think/shared';

function fileBytes(root: string, path: string): Buffer {
  if (!path || isAbsolute(path) || /^[a-z]:/i.test(path)) throw new Error('collaboration.artifact_path_invalid');
  const canonicalRoot = realpathSync(root);
  const target = realpathSync(resolve(canonicalRoot, path));
  const rel = relative(canonicalRoot, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('collaboration.artifact_outside_workspace');
  const stat = statSync(target);
  if (!stat.isFile() || stat.size < 1 || stat.size > 2_000_000) throw new Error('collaboration.artifact_file_size');
  return readFileSync(target);
}
export function existingArtifactHash(root: string | undefined, task: CollaborationTask): string | undefined {
  if (!root || task.deliverable?.kind !== 'file' || !task.deliverable.path) return undefined;
  try { return createHash('sha256').update(fileBytes(root, task.deliverable.path)).digest('hex'); } catch { return undefined; }
}
export function submitCollaborationArtifact(input: {
  task: CollaborationTask; attempt: CollaborationAttempt; content?: unknown; workspaceRoot?: string; previousHash?: string;
}): CollaborationArtifact {
  const { task, attempt } = input;
  const contract = task.deliverable;
  if (!contract || task.kind !== 'task') throw new Error('collaboration.artifact_contract_required');
  let bytes: Buffer;
  let content: string | undefined;
  if (contract.kind === 'file') {
    if (!input.workspaceRoot || !contract.path) throw new Error('collaboration.artifact_workspace_required');
    bytes = fileBytes(input.workspaceRoot, contract.path);
  } else {
    if (typeof input.content !== 'string' || !input.content.trim()) throw new Error('collaboration.artifact_content_required');
    content = input.content.trim();
    bytes = Buffer.from(content, 'utf8');
    if (bytes.length > 500_000) throw new Error('collaboration.artifact_document_too_large');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (contract.kind === 'file' && input.previousHash === sha256) throw new Error('collaboration.artifact_unchanged:本轮未生成或更新约定文件');
  return { id: `${attempt.id}:${sha256.slice(0, 16)}`, taskId: task.id, attemptId: attempt.id,
    title: contract.title, kind: contract.kind, content, path: contract.path, sha256, bytes: bytes.length, createdAt: new Date().toISOString() };
}
