import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/usage-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const clientSource = readFileSync(
  new URL('../src/main/runtime-client.ts', import.meta.url),
  'utf8',
);

describe('Usage IPC wiring', () => {
  it('registers summary reads through the typed Usage boundary', () => {
    expect(handlerSource).toContain("host.handle('runtime:usage-summary'");
    expect(handlerSource).toContain("host.requestUsage('usage.summary'");
    expect(mainSource).toContain('registerUsageHandlers({');
    expect(mainSource).toContain('requestUsage:');
    expect(mainSource).not.toContain("request('usage.summary'");
  });

  it('keeps the Renderer bridge and long-running timeout policy intact', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:usage-summary', payload)");
    expect(globalSource).toContain('getUsageSummary(payload?: UsageSummaryPayload)');
    expect(globalSource).toContain('Promise<UsageSummaryResponse>');
    expect(clientSource).toContain("if (type === 'usage.summary') return");
    expect(clientSource).toContain('USAGE_SUMMARY_REQUEST_TIMEOUT_MS = 300_000');
  });
});
