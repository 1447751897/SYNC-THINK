/**
 * GitHub webhook configuration CLI.
 *
 *   pnpm webhook:github setup   --repo owner/name --model <modelId> [options]
 *   pnpm webhook:github status
 *   pnpm webhook:github disable
 *
 * The shared secret is read from stdin or generated, stored in the SecureStore
 * (DPAPI vault on Windows) and only its handle is persisted in `app_setting`.
 * It is never accepted as an argv flag: argv is visible to every process on the
 * machine through the process table and lands in shell history.
 *
 * Config changes are picked up by the running daemon on its next 15s rescan;
 * there is no restart and no separate reload channel.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDatabaseAsync, runMigrations, SqliteAppSettingStore } from '@sync-think/storage';
import type { ScheduledTaskTarget } from '@sync-think/shared';
import { applyDaemonBootstrap } from './bootstrap.js';
import { createRuntimeSecureStore, resolveRuntimeDatabasePath } from '../persistence.js';
import {
  GITHUB_WEBHOOK_PATH,
  GITHUB_WEBHOOK_SETTING_KEY,
  parseGitHubWebhookConfig,
  shouldServeGitHubWebhook,
  type GitHubWebhookConfig,
  type GitHubWebhookRouteConfig,
} from './github-webhook.js';

export interface GitHubWebhookCliArgs {
  command: 'setup' | 'status' | 'disable' | 'help';
  repository?: string;
  target?: ScheduledTaskTarget;
  ref?: string;
  events?: string[];
  workspaceId?: string;
  instruction?: string;
  port?: number;
  host?: string;
  /** Read the secret from stdin instead of generating one. */
  secretFromStdin: boolean;
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

export function parseGitHubWebhookCliArgs(argv: string[]): GitHubWebhookCliArgs {
  const args = argv.filter((value) => value !== '--bootstrap');
  const command = args.find((value) => !value.startsWith('--'));
  const repository = flagValue(args, '--repo');
  const modelId = flagValue(args, '--model');
  const agentId = flagValue(args, '--agent');
  const teamId = flagValue(args, '--team');
  const port = flagValue(args, '--port');
  const events = flagValue(args, '--events');
  const target: ScheduledTaskTarget | undefined = modelId
    ? { kind: 'model', modelId }
    : agentId
      ? { kind: 'agent', agentId }
      : teamId
        ? { kind: 'team', teamId }
        : undefined;
  return {
    command:
      command === 'setup' || command === 'status' || command === 'disable' ? command : 'help',
    ...(repository ? { repository } : {}),
    ...(target ? { target } : {}),
    ...(flagValue(args, '--ref') ? { ref: flagValue(args, '--ref')! } : {}),
    ...(events
      ? {
          events: events
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        }
      : {}),
    ...(flagValue(args, '--workspace') ? { workspaceId: flagValue(args, '--workspace')! } : {}),
    ...(flagValue(args, '--instruction') ? { instruction: flagValue(args, '--instruction')! } : {}),
    ...(port && Number.isSafeInteger(Number(port)) ? { port: Number(port) } : {}),
    ...(flagValue(args, '--host') ? { host: flagValue(args, '--host')! } : {}),
    secretFromStdin: args.includes('--secret-stdin'),
  };
}

/**
 * Merge a route into the config, replacing any route with the same id.
 *
 * Re-running `setup` for a repository must update it in place rather than
 * stacking duplicates — two matching routes would both fire on one push.
 */
export function upsertGitHubRoute(
  config: GitHubWebhookConfig,
  route: GitHubWebhookRouteConfig,
): GitHubWebhookConfig {
  return {
    ...config,
    routes: [...config.routes.filter((existing) => existing.id !== route.id), route],
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

const USAGE = `GitHub webhook 配置

  pnpm webhook:github setup --repo <owner/name> (--model <id> | --agent <id> | --team <id>)
      [--ref main] [--events push,pull_request] [--workspace <id>]
      [--instruction "..."] [--port 8765] [--host 127.0.0.1] [--secret-stdin]
  pnpm webhook:github status
  pnpm webhook:github disable

密钥从 stdin 读取（--secret-stdin）或自动生成；只有句柄写入配置，密钥进 SecureStore。
`;

export async function runGitHubWebhookCli(argv: string[]): Promise<number> {
  const args = parseGitHubWebhookCliArgs(argv);
  if (args.command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const dbPath = process.env.SYNC_THINK_DB_PATH ?? resolveRuntimeDatabasePath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const secureStore = createRuntimeSecureStore();
  try {
    const settings = new SqliteAppSettingStore(connection.raw);
    const current = parseGitHubWebhookConfig(settings.get(GITHUB_WEBHOOK_SETTING_KEY)?.value);

    if (args.command === 'status') {
      process.stdout.write(
        `${JSON.stringify(
          {
            serving: shouldServeGitHubWebhook(current),
            enabled: current.enabled,
            host: current.host,
            port: current.port,
            path: GITHUB_WEBHOOK_PATH,
            // The handle is an opaque id, not the secret; showing whether one
            // exists is what the user needs to debug a 500 secret-unavailable.
            secretConfigured: Boolean(current.secretHandle),
            routes: current.routes,
          },
          null,
          2,
        )}\n`,
      );
      return 0;
    }

    if (args.command === 'disable') {
      // Keep the routes and the handle: disabling is reversible, and dropping
      // the secret would force the user to reconfigure GitHub's side too.
      settings.set(GITHUB_WEBHOOK_SETTING_KEY, { ...current, enabled: false });
      process.stdout.write('github webhook disabled\n');
      return 0;
    }

    if (!args.repository || !args.target) {
      process.stderr.write('setup 需要 --repo 与 --model/--agent/--team\n');
      return 1;
    }
    if (!/^[^/\s]+\/[^/\s]+$/.test(args.repository)) {
      process.stderr.write('--repo 必须是 owner/name 形式\n');
      return 1;
    }

    const secret = args.secretFromStdin ? await readStdin() : randomBytes(32).toString('hex');
    if (!secret) {
      process.stderr.write('--secret-stdin 未读到密钥\n');
      return 1;
    }
    const secretHandle = await secureStore.storeSecret(secret);

    const route: GitHubWebhookRouteConfig = {
      id: args.repository.toLowerCase(),
      repository: args.repository,
      ...(args.events && args.events.length > 0 ? { events: args.events } : {}),
      ...(args.ref ? { ref: args.ref } : {}),
      target: args.target,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      ...(args.instruction ? { instruction: args.instruction } : {}),
    };
    const next = upsertGitHubRoute(
      {
        ...current,
        enabled: true,
        ...(args.port !== undefined ? { port: args.port } : {}),
        ...(args.host ? { host: args.host } : {}),
        secretHandle,
      },
      route,
    );
    settings.set(GITHUB_WEBHOOK_SETTING_KEY, next);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          listen: `http://${next.host}:${next.port}${GITHUB_WEBHOOK_PATH}`,
          repository: route.repository,
          events: route.events ?? ['push'],
          // Printed once, to stdout only, so the user can paste it into
          // GitHub's "Secret" field. It is not persisted in plaintext anywhere.
          secret: args.secretFromStdin ? '(从 stdin 读取)' : secret,
          hint: 'GitHub → Settings → Webhooks：Content type 选 application/json；daemon 将在下次 rescan（≤15s）生效',
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } finally {
    secureStore.shutdown();
    if (connection.raw.open) connection.raw.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  void (async () => {
    const bootstrapPath = process.env.SYNC_THINK_DAEMON_BOOTSTRAP;
    if (bootstrapPath) await applyDaemonBootstrap(bootstrapPath);
    process.exitCode = await runGitHubWebhookCli(process.argv.slice(2));
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
