import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

function workspaceRoot(cwd: string): string | undefined {
  let candidate = resolve(cwd);
  for (;;) {
    if (existsSync(join(candidate, 'pnpm-workspace.yaml')) &&
        existsSync(join(candidate, 'apps', 'desktop', 'package.json'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

/** One durable image root shared by Desktop and Runtime, independent of package cwd. */
export function resolveChatMessageImageDirectories(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
  cwd = process.cwd(),
  homeDirectory = homedir(),
): string[] {
  const workspace =
    (env.SYNC_THINK_DB_PATH ? workspaceRoot(dirname(resolve(env.SYNC_THINK_DB_PATH))) : undefined) ??
    (env.SYNC_THINK_CHAT_MESSAGE_IMAGES ? workspaceRoot(env.SYNC_THINK_CHAT_MESSAGE_IMAGES) : undefined) ??
    workspaceRoot(cwd);
  const primary = env.SYNC_THINK_CHAT_MESSAGE_IMAGES
    ? resolve(env.SYNC_THINK_CHAT_MESSAGE_IMAGES)
    : env.SYNC_THINK_DB_PATH
      ? join(dirname(resolve(env.SYNC_THINK_DB_PATH)), 'message-images')
      : workspace
        ? join(workspace, '.data', 'SYNC-THINK', 'message-images')
        : resolve(join(env.LOCALAPPDATA ?? homeDirectory, 'SYNC-THINK', 'message-images'));
  // Old Desktop launches selected their package-local .data first. Keep those
  // immutable attachments readable; new writes always use the primary root.
  const legacy = workspace
    ? join(workspace, 'apps', 'desktop', '.data', 'SYNC-THINK', 'message-images')
    : undefined;
  return [...new Set([primary, ...(legacy ? [legacy] : [])])];
}
