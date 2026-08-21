/**
 * GitHub webhook configuration CLI: argument parsing and route merging.
 *
 * Two hazards live here. The secret must never be reachable through argv (the
 * process table and shell history are both readable), and re-running `setup`
 * for a repository must replace its route rather than stack a duplicate — two
 * matching routes would start two runs from one push.
 */
import { describe, expect, it } from 'vitest';
import {
  parseGitHubWebhookCliArgs,
  upsertGitHubRoute,
} from '../src/daemon/github-webhook-config.js';
import type {
  GitHubWebhookConfig,
  GitHubWebhookRouteConfig,
} from '../src/daemon/github-webhook.js';

const BASE: GitHubWebhookConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 8765,
  secretHandle: 'handle-1',
  routes: [],
};

function route(overrides: Partial<GitHubWebhookRouteConfig> = {}): GitHubWebhookRouteConfig {
  return {
    id: 'acme/widgets',
    repository: 'acme/widgets',
    target: { kind: 'model', modelId: 'model-1' },
    ...overrides,
  };
}

describe('github webhook cli arguments', () => {
  it('parses a full setup invocation', () => {
    const args = parseGitHubWebhookCliArgs([
      'setup',
      '--repo',
      'acme/widgets',
      '--model',
      'model-1',
      '--ref',
      'main',
      '--events',
      'push, pull_request',
      '--workspace',
      'ws-1',
      '--instruction',
      '跑一遍测试',
      '--port',
      '9000',
      '--host',
      '0.0.0.0',
    ]);
    expect(args).toMatchObject({
      command: 'setup',
      repository: 'acme/widgets',
      target: { kind: 'model', modelId: 'model-1' },
      ref: 'main',
      events: ['push', 'pull_request'],
      workspaceId: 'ws-1',
      instruction: '跑一遍测试',
      port: 9000,
      host: '0.0.0.0',
      secretFromStdin: false,
    });
  });

  it('has no way to pass a secret through argv', () => {
    // argv is world-readable via the process table and lands in shell history.
    // The only channels are stdin and generation, so a --secret flag must be
    // inert rather than quietly accepted.
    const args = parseGitHubWebhookCliArgs([
      'setup',
      '--repo',
      'acme/widgets',
      '--model',
      'm',
      '--secret',
      'hunter2',
    ]);
    expect(JSON.stringify(args)).not.toContain('hunter2');
    expect(args.secretFromStdin).toBe(false);
    expect(parseGitHubWebhookCliArgs(['setup', '--secret-stdin']).secretFromStdin).toBe(true);
  });

  it('resolves exactly one target kind, preferring model over agent over team', () => {
    expect(parseGitHubWebhookCliArgs(['setup', '--agent', 'a-1']).target).toEqual({
      kind: 'agent',
      agentId: 'a-1',
    });
    expect(parseGitHubWebhookCliArgs(['setup', '--team', 't-1']).target).toEqual({
      kind: 'team',
      teamId: 't-1',
    });
    expect(parseGitHubWebhookCliArgs(['setup', '--model', 'm-1', '--agent', 'a-1']).target).toEqual(
      { kind: 'model', modelId: 'm-1' },
    );
    expect(parseGitHubWebhookCliArgs(['setup']).target).toBeUndefined();
  });

  it('treats an unknown or absent command as help', () => {
    expect(parseGitHubWebhookCliArgs([]).command).toBe('help');
    expect(parseGitHubWebhookCliArgs(['frobnicate']).command).toBe('help');
    for (const command of ['setup', 'status', 'disable']) {
      expect(parseGitHubWebhookCliArgs([command]).command).toBe(command);
    }
  });

  it('ignores a flag whose value is missing or is another flag', () => {
    // `--repo --model x` must not silently configure a repository named
    // "--model"; the route would match nothing and the failure would be silent.
    const args = parseGitHubWebhookCliArgs(['setup', '--repo', '--model', 'model-1']);
    expect(args.repository).toBeUndefined();
    expect(args.target).toEqual({ kind: 'model', modelId: 'model-1' });
    expect(parseGitHubWebhookCliArgs(['setup', '--port']).port).toBeUndefined();
    expect(parseGitHubWebhookCliArgs(['setup', '--port', 'abc']).port).toBeUndefined();
  });

  it('drops the bootstrap flag consumed by the daemon entrypoint', () => {
    expect(parseGitHubWebhookCliArgs(['--bootstrap', 'status']).command).toBe('status');
  });
});

describe('github webhook route merging', () => {
  it('replaces a route with the same id instead of duplicating it', () => {
    // Two routes matching one push would dispatch the event twice.
    const first = upsertGitHubRoute(BASE, route({ ref: 'main' }));
    const second = upsertGitHubRoute(first, route({ ref: 'develop' }));
    expect(second.routes).toHaveLength(1);
    expect(second.routes[0]).toMatchObject({ id: 'acme/widgets', ref: 'develop' });
  });

  it('keeps routes for other repositories intact', () => {
    const withOther = upsertGitHubRoute(
      BASE,
      route({ id: 'acme/other', repository: 'acme/other' }),
    );
    const merged = upsertGitHubRoute(withOther, route());
    expect(merged.routes.map((item) => item.id).sort()).toEqual(['acme/other', 'acme/widgets']);
  });

  it('preserves the surrounding listener settings', () => {
    const merged = upsertGitHubRoute({ ...BASE, port: 9100 }, route());
    expect(merged).toMatchObject({ enabled: true, port: 9100, secretHandle: 'handle-1' });
  });
});
