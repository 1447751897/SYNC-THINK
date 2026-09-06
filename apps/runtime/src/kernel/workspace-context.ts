/**
 * Workspace facts that every kernel needs before it starts exploring with
 * shell commands. Codex in particular likes to open with `git status`; when
 * the bound folder is not a repository that just paints a red failure.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function workspaceHasGitMetadata(workspaceDir: string): boolean {
  const root = workspaceDir.trim();
  if (!root) return false;
  try {
    return existsSync(join(root, '.git'));
  } catch {
    return false;
  }
}

/** One-line VCS hint for the host system prompt. */
export function describeWorkspaceVersionControl(workspaceDir: string): string {
  if (workspaceHasGitMetadata(workspaceDir)) {
    return 'Version control: this project folder is a git repository. Run git commands from this folder only.';
  }
  return 'Version control: this project folder is not a git repository. Do not run git commands; they will fail with "not a git repository".';
}
