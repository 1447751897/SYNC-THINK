import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/activity-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Activity Center IPC wiring', () => {
  it('registers Activity Center commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:activity-list-runs', 'activity.listRuns'],
      ['runtime:activity-list-external-events', 'activity.listExternalEvents'],
      ['runtime:activity-retry-anchor', 'activity.retryAnchor'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerActivityHandlers({');
    expect(mainSource).toContain('requestActivity:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:activity-list-runs',
      'runtime:activity-list-external-events',
      'runtime:activity-retry-anchor',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('activityListRuns(');
    expect(globalSource).toContain('activityListExternalEvents(');
    expect(globalSource).toContain('activityRetryAnchor(');
  });
});
