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
      'diagnostics',
      'long-trace-closed',
      'long-trace-open',
      'welcome',
    ]);
    assert.deepEqual([...themes].sort(), ['dark', 'light']);
    assert.ok(PHASE3_VISUAL_MATRIX.some((item) => item.scale === 1.25));
    assert.ok(PHASE3_VISUAL_MATRIX.some((item) => item.width <= 760));
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
    const driver = readFileSync(new URL('./phase3-visual-capture-electron.cjs', import.meta.url), 'utf8');
    assert.match(driver, /capturePage\(\)/);
    assert.match(driver, /setZoomFactor\(visualCase.scale\)/);
    assert.match(driver, /data-phase3-ready/);
    assert.match(driver, /document.fonts/);
  });
});
