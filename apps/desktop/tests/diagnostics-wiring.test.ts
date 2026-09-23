import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/diagnostics-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');

describe('Desktop Diagnostics wiring', () => {
  it('routes listDiagnostics through its strict parser and typed transport', () => {
    expect(handlerSource).toContain("host.handle('runtime:diagnostics-list'");
    expect(handlerSource).toContain("host.requestDiagnostics('diagnostics.list'");
    expect(handlerSource).toContain('parseListDiagnosticsPayload(value)');
    expect(preloadSource).toContain('listDiagnostics:');
    expect(preloadSource).toContain("'runtime:diagnostics-list'");
  });

  it('uses the typed Diagnostics transport from both Main call sites', () => {
    expect(mainSource).toContain('registerDiagnosticsHandlers({');
    expect(mainSource).toContain('requestDiagnostics:');
    expect(mainSource).toContain('const listed = await client.requestDiagnostics(');
    expect(mainSource).not.toContain("request('diagnostics.list'");
    expect(mainSource).not.toContain('request<{ diagnostics?: unknown[] }>(');
  });
});
