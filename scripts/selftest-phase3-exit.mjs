import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKSPACE_ROOT = resolve(dirname(SCRIPT_PATH), '..');

export const PHASE3_EXIT_STEPS = Object.freeze([
  {
    id: 'desktop-contracts',
    command: 'pnpm',
    args: [
      '--filter',
      '@sync-think/desktop',
      'exec',
      'vitest',
      'run',
      'src/diagnostics-export-contract.test.ts',
      'src/main/diagnostics-export.test.ts',
      'src/main/desktop-updater.test.ts',
      'src/renderer/shell/SettingsPage.test.tsx',
      'src/renderer/shell/FirstLaunchGuide.test.tsx',
      'src/renderer/shell/ShellApp.test.tsx',
      'src/renderer/shell/message-window.test.ts',
      'src/renderer/shell/long-thread-performance.test.ts',
      'src/renderer/shell/Phase3VisualFixture.test.tsx',
      'tests/desktop-updater-wiring.test.ts',
      'tests/diagnostics-export-wiring.test.ts',
      'tests/phase3-accessibility.test.ts',
      '--testTimeout=20000',
    ],
  },
  {
    id: 'release-and-visual-contracts',
    command: 'node',
    args: [
      '--test',
      'scripts/windows-installer-release.test.mjs',
      'scripts/windows-generic-update-feed.test.mjs',
      'scripts/selftest-windows-update-feed-e2e.test.mjs',
      'scripts/selftest-windows-update-install-e2e.test.mjs',
      'scripts/live-image-provider-acceptance.test.mjs',
      'scripts/phase3-visual-capture.test.mjs',
    ],
  },
  {
    id: 'desktop-typecheck',
    command: 'pnpm',
    args: ['--filter', '@sync-think/desktop', 'typecheck'],
  },
  {
    id: 'desktop-build',
    command: 'pnpm',
    args: ['--filter', '@sync-think/desktop', 'build'],
  },
  {
    id: 'prepare-update-feed-fixture',
    command: 'pnpm',
    args: ['prepare:update-feed-fixture:win'],
  },
  {
    id: 'generic-feed-e2e',
    command: 'pnpm',
    args: ['test:update-feed:prepared:win'],
  },
  {
    id: 'image-provider-build',
    command: 'pnpm',
    args: ['--filter', '@sync-think/adapters', '--filter', '@sync-think/runtime', 'build'],
  },
  {
    id: 'live-image-provider',
    command: 'node',
    args: ['scripts/live-image-provider-acceptance.mjs'],
  },
  {
    id: 'electron-visual-capture',
    command: 'node',
    args: ['scripts/phase3-visual-capture.mjs'],
  },
]);

export const PHASE3_EXTERNAL_EVIDENCE = Object.freeze([
  {
    id: 'windows-authenticode-release',
    status: 'pending-external',
    reason: '需要正式发布证书与 RFC 3161 timestamp 服务。',
  },
  {
    id: 'windows-signed-update-install',
    status: 'pending-external',
    reason: '需要使用正式签名 installer 与真实 RFC 3161 timestamp 完成一次 0.0.1 → 0.0.2 升级。',
  },
  {
    id: 'private-feed-rollout',
    status: 'pending-external',
    reason: '需要真实私有 HTTPS feed、授权、cohort 与 CDN 撤回演练。',
  },
  {
    id: 'live-image-provider-credentials',
    status: 'pending-when-skipped',
    reason: '本机无真实图片 Provider 凭证时验收脚本会明确跳过。',
  },
  {
    id: 'closed-user-cohort',
    status: 'pending-external',
    reason: '需要 5–20 位邀请用户完成 Windows 闭测与反馈记录。',
  },
]);

function commandInvocation(step) {
  if (process.platform === 'win32' && step.command === 'pnpm') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', ...step.args],
    };
  }
  return step;
}

export function runPhase3ExitSelftest(options = {}) {
  const runner =
    options.runner ??
    ((command, args) =>
      spawnSync(command, args, {
        cwd: WORKSPACE_ROOT,
        env: process.env,
        stdio: 'inherit',
        windowsHide: true,
      }));
  const completed = [];
  for (const step of PHASE3_EXIT_STEPS) {
    const invocation = commandInvocation(step);
    process.stdout.write('[phase3] ' + step.id + '\n');
    const result = runner(invocation.command, invocation.args, step);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const failure = new Error(
        'phase3.exit.step_failed:' + step.id + ':code=' + String(result.status),
      );
      failure.stepId = step.id;
      failure.completed = completed;
      throw failure;
    }
    completed.push(step.id);
  }
  return {
    status: 'passed-with-external-evidence-pending',
    completed,
    externalEvidence: PHASE3_EXTERNAL_EVIDENCE,
  };
}

function main() {
  try {
    const summary = runPhase3ExitSelftest();
    process.stdout.write('PHASE3_EXIT_SUMMARY=' + JSON.stringify(summary) + '\n');
  } catch (error) {
    const summary = {
      status: 'failed',
      failedStep: error?.stepId ?? 'unknown',
      completed: error?.completed ?? [],
      externalEvidence: PHASE3_EXTERNAL_EVIDENCE,
      error: error instanceof Error ? error.message : String(error),
    };
    process.stderr.write('PHASE3_EXIT_SUMMARY=' + JSON.stringify(summary) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) main();
