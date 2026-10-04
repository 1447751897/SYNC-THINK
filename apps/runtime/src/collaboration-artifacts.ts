import { createHash } from 'node:crypto';
import { measureCollaborationText } from './collaboration-text-metrics.js';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
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
/** Keep submitted versions stable even when a later attempt overwrites the working file. */
function persistArtifactVersion(root: string, attemptId: string, logicalPath: string, bytes: Buffer, hash: string): string {
  const canonical = realpathSync(root);
  const id = createHash('sha256').update(attemptId).digest('hex').slice(0, 32);
  let directory = canonical;
  for (const component of ['.artifacts', id]) {
    directory = resolve(directory, component);
    if (!existsSync(directory)) mkdirSync(directory);
    if (lstatSync(directory).isSymbolicLink()) throw new Error('collaboration.artifact_directory_alias');
    const rel = relative(canonical, realpathSync(directory));
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('collaboration.artifact_outside_workspace');
  }
  const suffix = /^\.[a-z0-9]{1,10}$/i.test(extname(logicalPath)) ? extname(logicalPath) : '.bin';
  const target = resolve(directory, hash + suffix);
  try { writeFileSync(target, bytes, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = fileBytes(canonical, relative(canonical, target));
    if (createHash('sha256').update(existing).digest('hex') !== hash) throw new Error('collaboration.artifact_version_modified');
  }
  return target;
}
export function existingArtifactHash(root: string | undefined, task: CollaborationTask): string | undefined {
  if (!root || task.deliverable?.kind !== 'file' || !task.deliverable.path) return undefined;
  try { return createHash('sha256').update(fileBytes(root, task.deliverable.path)).digest('hex'); } catch { return undefined; }
}
export function submitCollaborationArtifact(input: {
  task: CollaborationTask; attempt: CollaborationAttempt; content?: unknown; workspaceRoot?: string;
  /** Version storage can be room-scoped while file contracts resolve in the bound project. */
  artifactStorageRoot?: string; previousHash?: string;
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
  const storageRoot = input.artifactStorageRoot ?? input.workspaceRoot;
  const storedPath = storageRoot ? persistArtifactVersion(storageRoot, attempt.id, contract.kind === 'file' ? contract.path! : 'document.md', bytes, sha256) : undefined;
  return { id: `${attempt.id}:${sha256.slice(0, 16)}`, taskId: task.id, attemptId: attempt.id,
    title: contract.title, kind: contract.kind, content, path: contract.path, storedPath, textMetrics: content === undefined ? undefined : measureCollaborationText(content), sha256, bytes: bytes.length, createdAt: new Date().toISOString() };
}
