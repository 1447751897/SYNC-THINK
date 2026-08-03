import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE3_EXIT_STEPS,
  PHASE3_EXTERNAL_EVIDENCE,
  runPhase3ExitSelftest,
} from './selftest-phase3-exit.mjs';

describe('Phase 3 exit selftest plan', () => {
  it('covers local contracts, build, updater E2E, live provider, and Electron visuals', () => {
    const ids = PHASE3_EXIT_STEPS.map((step) => step.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, [
      'desktop-contracts',
      'release-and-visual-contracts',
      'desktop-typecheck',
      'desktop-build',
      'generic-feed-e2e',
      'image-provider-build',
      'live-image-provider',
      'electron-visual-capture',
    ]);
  });

  it('keeps paid credentials, signed installs, private rollout, and user cohort as external evidence', () => {
    const ids = PHASE3_EXTERNAL_EVIDENCE.map((item) => item.id);
    assert.ok(ids.includes('windows-authenticode-release'));
    assert.ok(ids.includes('windows-signed-update-install'));
    assert.ok(!ids.includes('blockmap-aware-real-install'));
    assert.ok(ids.includes('private-feed-rollout'));
    assert.ok(ids.includes('live-image-provider-credentials'));
    assert.ok(ids.includes('closed-user-cohort'));
    assert.ok(PHASE3_EXTERNAL_EVIDENCE.every((item) => item.status.startsWith('pending')));
  });

  it('runs every local step in order and emits an honest pending-external status', () => {
    const seen = [];
    const result = runPhase3ExitSelftest({
      runner: (_command, _args, step) => {
        seen.push(step.id);
        return { status: 0 };
      },
    });
    assert.deepEqual(
      seen,
      PHASE3_EXIT_STEPS.map((step) => step.id),
    );
    assert.equal(result.status, 'passed-with-external-evidence-pending');
    assert.deepEqual(result.completed, seen);
  });

  it('stops at the first failed gate and carries completed-step evidence', () => {
    let calls = 0;
    assert.throws(
      () =>
        runPhase3ExitSelftest({
          runner: () => {
            calls += 1;
            return { status: calls === 3 ? 2 : 0 };
          },
        }),
      (error) => {
        assert.equal(error.stepId, 'desktop-typecheck');
        assert.deepEqual(error.completed, ['desktop-contracts', 'release-and-visual-contracts']);
        return true;
      },
    );
    assert.equal(calls, 3);
  });
});
