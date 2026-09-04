import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE3_VISUAL_MATRIX,
  parsePhase3VisualArgs,
  validatePhase3VisualManifest,
} from './phase3-visual-capture.mjs';

function captureFor(item) {
  return {
    ...item,
    file: item.id + '.png',
    width: item.width,
    height: item.height,
    bytes: 24000,
    sha256: 'a'.repeat(64),
  };
}

describe('Phase 3 visual matrix', () => {
  it('covers themes, long traces, diagnostics, responsive width, and 125% scaling', () => {
    const fixtures = new Set(PHASE3_VISUAL_MATRIX.map((item) => item.fixture));
    const themes = new Set(PHASE3_VISUAL_MATRIX.map((item) => item.theme));
    assert.deepEqual([...fixtures].sort(), [
      'composer-slash-open',
      'connection-and-code',
      'diagnostics',
      'inline-process-hierarchy',
      'long-trace-closed',
      'long-trace-open',
      'streaming-follow',
      'task-status-panel',
      'welcome',
      'workspace-file',
    ]);
    assert.deepEqual([...themes].sort(), ['dark', 'light']);
    assert.ok(PHASE3_VISUAL_MATRIX.some((item) => item.scale === 1.25));
    assert.ok(PHASE3_VISUAL_MATRIX.some((item) => item.width <= 760));
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) =>
          item.id === 'composer-slash-open-dark' &&
          item.fixture === 'composer-slash-open' &&
          item.theme === 'dark' &&
          item.scale === 1 &&
          item.width === 986 &&
          item.height === 560,
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) =>
          item.fixture === 'long-trace-open' && item.theme === 'dark' && item.width === 1280,
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) =>
          item.fixture === 'inline-process-hierarchy' &&
          item.theme === 'light' &&
          item.width === 1280,
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) =>
          item.fixture === 'inline-process-hierarchy' && item.theme === 'dark' && item.width <= 760,
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) => item.fixture === 'task-status-panel' && item.state === 'wallpaper-switch',
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) =>
          item.fixture === 'workspace-file' && item.theme === 'light' && item.width === 1280,
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) => item.fixture === 'workspace-file' && item.theme === 'dark' && item.width === 1280,
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) =>
          item.fixture === 'workspace-file' &&
          item.state === 'source-copied' &&
          item.theme === 'light',
      ),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some((item) => item.fixture === 'workspace-file' && item.width <= 760),
    );
    assert.ok(
      PHASE3_VISUAL_MATRIX.some(
        (item) =>
          item.id === 'workspace-file-reference-tall' && item.width === 735 && item.height === 1014,
      ),
    );
  });

  it('parses output overrides and rejects unknown arguments', () => {
    assert.deepEqual(parsePhase3VisualArgs([]), { outputDir: undefined });
    assert.deepEqual(parsePhase3VisualArgs(['--output-dir', '.data/custom']), {
      outputDir: '.data/custom',
    });
    assert.throws(() => parsePhase3VisualArgs(['--baseline']), /unknown_argument/);
  });

  it('rejects missing, duplicate, undersized, and unhashed captures', () => {
    const valid = {
      schemaVersion: 1,
      captures: PHASE3_VISUAL_MATRIX.map(captureFor),
    };
    assert.deepEqual(validatePhase3VisualManifest(valid), { ok: true, errors: [] });

    const invalid = structuredClone(valid);
    invalid.captures.pop();
    invalid.captures[0].bytes = 1;
    invalid.captures[1].sha256 = 'bad';
    invalid.captures.push({ ...invalid.captures[1] });
    const validation = validatePhase3VisualManifest(invalid);
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((error) => error.startsWith('capture.missing:')));
    assert.ok(validation.errors.some((error) => error.startsWith('capture.id_duplicate:')));
    assert.ok(validation.errors.some((error) => error.startsWith('capture.bytes_invalid:')));
    assert.ok(validation.errors.some((error) => error.startsWith('capture.sha256_invalid:')));
  });

  it('uses Electron capturePage with zoom and waits for the fixture readiness marker', () => {
    const driver = readFileSync(
      new URL('./phase3-visual-capture-electron.cjs', import.meta.url),
      'utf8',
    );
    assert.match(driver, /capturePage\(\)/);
    assert.match(driver, /setZoomFactor\(visualCase.scale\)/);
    assert.match(driver, /data-phase3-ready/);
    assert.match(driver, /document.fonts/);
    assert.match(driver, /execution_timeline_invalid/);
    assert.match(driver, /execution-commentary-item/);
    assert.doesNotMatch(driver, /execution-reasoning-item/);
    assert.match(driver, /execution_timeline_closed_invalid/);
    assert.match(driver, /connection_code_invalid/);
    assert.match(driver, /streaming_follow_invalid/);
    assert.match(driver, /composer_geometry_invalid/);
    assert.match(driver, /composer-slash-open-menu/);
    assert.match(driver, /workspace_file_invalid/);
    assert.match(driver, /workspace_file_source_invalid/);
    assert.match(driver, /workspace_file_clarity_invalid/);
    assert.match(driver, /workspace_file_alignment_invalid/);
    assert.match(driver, /workspace_file_background_invalid/);
    assert.match(driver, /explorerPresent/);
    assert.match(driver, /editorFillsRoot/);
    assert.match(driver, /editorBody/);
    assert.match(driver, /previewBody/);
    assert.match(driver, /sourceBody/);
    assert.match(driver, /expectedChatBody/);
    assert.match(driver, /resolvedTokenBackground/);
    assert.match(driver, /--color-chat/);
  });
});
