/**
 * Codex spawn argv must survive the cmd.exe shim whitelist.
 *
 * On Windows the `codex` executable is an npm `.cmd` shim, so
 * `startKernelProcess` routes the whole argv through
 * `buildSafeCmdShimCommand`, whose whitelist rejects `" % ^ ! & | < > * ?`.
 * A single rejected character anywhere fails the spawn with "kernel args
 * contain unsafe shell metacharacters" *before* codex runs — the run dies in
 * well under a second with no provider request attempted.
 *
 * That is precisely how the `JSON.stringify`-quoted `model_provider*` overrides
 * shipped broken on Windows: the MCP override builder had its own single-quote
 * test, but nothing fed the *assembled* argv through the real whitelist. These
 * tests close that gap — they are the regression fence for the whole command
 * line, not for one builder.
 */
import { describe, expect, it } from 'vitest';
import { buildSafeCmdShimCommand } from '@sync-think/workers';
import type { KernelRequest, PlatformBrokerInfo } from '@sync-think/shared';
import { buildCodexSpawnCommand } from './codex-adapter.js';
import { tomlLiteral, tomlLiteralArray } from './platform-mcp-config.js';

function makeBroker(): PlatformBrokerInfo {
  return {
    host: '127.0.0.1',
    port: 54289,
    token: 'UJxu2LYppGkYTIIDjKbqgXCkbHeg6lBu',
    // Real-world Windows paths with backslashes — the shape that actually ships.
    workspaceDir: 'D:\\projects\\cuitaliao',
    command: 'C:\\Users\\Administrator\\AppData\\Local\\pnpm\\nodejs\\20.20.2\\node.exe',
    args: ['D:\\projects\\MYSELF\\SYNC-THINK\\apps\\mcp-server\\platform-mcp-server.mjs'],
  };
}

function makeRequest(overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId: 'codex',
    model: '64M3HM1GGECNNZ2A0926292MJW',
    providerModelId: 'gpt-5.6-luna',
    userText: '能聊天吗？',
    contextWindow: 128_000,
    effectiveContextWindow: 128_000,
    contextWindowSource: 'configured',
    credential: { baseUrl: 'https://www.kamenking.top', apiKey: 'sk-test-key' },
    systemContext: '',
    platformTools: [],
    platformBroker: makeBroker(),
    permissionMode: 'full-access',
    workspaceDir: 'D:\\projects\\cuitaliao',
    reasoningEffort: 'high',
    session: { mode: 'create' },
    ...overrides,
  } as KernelRequest;
}

describe('codex spawn argv / cmd.exe shim safety', () => {
  it('produces an argv the cmd shim whitelist accepts (the real spawn gate)', () => {
    const { args } = buildCodexSpawnCommand(makeRequest());
    // This is the exact call startKernelProcess makes for a `.cmd` executable.
    expect(buildSafeCmdShimCommand('C:\\npm\\codex.cmd', args)).not.toBeUndefined();
  });

  it('never emits a double quote anywhere on the command line', () => {
    // `"` is the first entry in SAFE_CMD_SHIM_METACHARS; JSON.stringify emits it.
    const { args } = buildCodexSpawnCommand(makeRequest());
    expect(args.join(' ')).not.toContain('"');
  });

  it('quotes the per-run provider overrides as TOML literal strings', () => {
    const joined = buildCodexSpawnCommand(makeRequest()).args.join(' ');
    expect(joined).toContain(`model_providers.`);
    expect(joined).toMatch(/model_provider='st_[0-9a-f]{12}'/);
    expect(joined).toContain(`.name='SYNC-THINK'`);
    expect(joined).toContain(`.base_url='https://www.kamenking.top'`);
    expect(joined).toContain(`.wire_api='responses'`);
    expect(joined).toMatch(/\.env_key='ST_KERNEL_KEY_[0-9a-f]{8}'/);
    // Booleans are bare TOML, not quoted strings.
    expect(joined).toContain('.requires_openai_auth=false');
  });

  it('keeps the api key out of argv and passes it through env only', () => {
    const { args, env } = buildCodexSpawnCommand(makeRequest());
    expect(args.join(' ')).not.toContain('sk-test-key');
    expect(env.OPENAI_API_KEY).toBe('sk-test-key');
    const envKeyName = Object.keys(env).find((key) => key.startsWith('ST_KERNEL_KEY_'));
    expect(envKeyName).toBeTruthy();
    expect(env[envKeyName!]).toBe('sk-test-key');
  });

  it('never puts the user prompt on the command line', () => {
    const { args } = buildCodexSpawnCommand(makeRequest({ userText: 'rm -rf & echo pwned' }));
    expect(args.join(' ')).not.toContain('pwned');
    expect(args.at(-1)).toBe('-');
  });

  it('stays shim-safe without a broker and without injected credentials', () => {
    const { args } = buildCodexSpawnCommand(
      makeRequest({ platformBroker: undefined, credential: { reuseLocalLogin: true } }),
    );
    expect(buildSafeCmdShimCommand('C:\\npm\\codex.cmd', args)).not.toBeUndefined();
    expect(args.join(' ')).not.toContain('model_provider=');
  });

  it('stays shim-safe when resuming a kernel session', () => {
    const { args } = buildCodexSpawnCommand(
      makeRequest({ session: { mode: 'resume', id: 'thread-abc123' } }),
    );
    expect(buildSafeCmdShimCommand('C:\\npm\\codex.cmd', args)).not.toBeUndefined();
    expect(args.slice(-3)).toEqual(['resume', 'thread-abc123', '-']);
  });
});

describe('tomlLiteral', () => {
  it('wraps values in single quotes so the cmd shim accepts them', () => {
    expect(tomlLiteral('responses')).toBe("'responses'");
    expect(tomlLiteral('D:\\projects\\x')).toBe("'D:\\projects\\x'");
  });

  it('builds literal string arrays', () => {
    expect(tomlLiteralArray(['a', 'b'])).toBe("['a','b']");
  });

  it('refuses a value containing a single quote instead of emitting invalid TOML', () => {
    // TOML literal strings have no escape mechanism: a `'` inside one cannot be
    // represented, and emitting it raw would make codex fail to parse its own
    // config. Fail loudly at the boundary instead.
    expect(() => tomlLiteral("D:\\it's\\here")).toThrow(/single quote/);
    expect(() => tomlLiteralArray(["ok", "no'pe"])).toThrow(/single quote/);
  });
});
