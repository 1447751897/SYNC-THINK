import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseVisualReviewOutcome,
  readLiveImageAcceptanceConfig,
  scrubAcceptanceError,
} from './live-image-provider-acceptance.mjs';

test('live image acceptance defaults to an explicit no-credential skip', () => {
  assert.deepEqual(readLiveImageAcceptanceConfig({}), {
    skip: true,
    reason: 'SYNC_THINK_LIVE_IMAGE_API_KEY/OPENAI_API_KEY is not configured',
  });
});

test('live image acceptance requires a visual reviewer model when enabled', () => {
  assert.throws(
    () => readLiveImageAcceptanceConfig({ SYNC_THINK_LIVE_IMAGE_API_KEY: 'secret' }),
    /SYNC_THINK_LIVE_IMAGE_REVIEW_MODEL/,
  );
});

test('live image acceptance normalizes bounded configuration without exposing secrets', () => {
  const config = readLiveImageAcceptanceConfig({
    SYNC_THINK_LIVE_IMAGE_API_KEY: 'image-secret',
    SYNC_THINK_LIVE_IMAGE_REVIEW_API_KEY: 'review-secret',
    SYNC_THINK_LIVE_IMAGE_REVIEW_MODEL: 'vision-model',
    SYNC_THINK_LIVE_IMAGE_COUNT: '3',
    SYNC_THINK_LIVE_IMAGE_SELECTED_INDEX: '2',
    SYNC_THINK_LIVE_IMAGE_TIMEOUT_MS: '90000',
  });
  assert.equal(config.skip, false);
  assert.equal(config.count, 3);
  assert.equal(config.selectedIndex, 2);
  assert.equal(config.timeoutMs, 90_000);
  assert.equal(config.reviewModel, 'vision-model');
  assert.equal(JSON.stringify({ ...config, apiKey: '[REDACTED]', reviewApiKey: '[REDACTED]' }).includes('image-secret'), false);
  assert.throws(
    () =>
      readLiveImageAcceptanceConfig({
        SYNC_THINK_LIVE_IMAGE_API_KEY: 'secret',
        SYNC_THINK_LIVE_IMAGE_REVIEW_MODEL: 'vision-model',
        SYNC_THINK_LIVE_IMAGE_COUNT: '1',
      }),
    /between 2 and 4/,
  );
});

test('visual review parser accepts plain or fenced JSON and rejects incomplete outcomes', () => {
  assert.deepEqual(
    parseVisualReviewOutcome('{"status":"pass","summary":"good","feedback":"polish edges"}'),
    { status: 'pass', summary: 'good', feedback: 'polish edges' },
  );
  assert.deepEqual(
    parseVisualReviewOutcome('```json\n{"status":"needs_rework","summary":"flat","feedback":"add depth"}\n```'),
    { status: 'needs_rework', summary: 'flat', feedback: 'add depth' },
  );
  assert.throws(() => parseVisualReviewOutcome('{"status":"pass"}'), /summary and feedback/);
});

test('acceptance errors scrub every configured credential', () => {
  assert.equal(
    scrubAcceptanceError(new Error('image-secret / review-secret'), ['image-secret', 'review-secret']),
    '[REDACTED] / [REDACTED]',
  );
});
