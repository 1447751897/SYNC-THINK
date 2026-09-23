import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/kernel-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('kernel discovery IPC wiring', () => {
  it('registers the read-only command through the typed Kernel boundary', () => {
    expect(handlerSource).toContain("host.handle('runtime:kernel-detect'");
    expect(handlerSource).toContain('host.assertSource(event)');
    expect(handlerSource).toContain('host.ensureConnection()');
    expect(handlerSource).toContain("host.requestKernel('kernel.detect', {})");
    expect(mainSource).toContain('registerKernelHandlers({');
    expect(mainSource).toContain('requestKernel:');
    expect(mainSource).not.toContain("request<KernelDetectResponse>('kernel.detect'");
    expect(mainSource).toContain("requestKernel('kernel.recycle', { kernelId })");
    expect(mainSource).not.toContain("request('kernel.recycle'");
  });

  it('keeps the Renderer bridge payload-free and response typed', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:kernel-detect')");
    expect(preloadSource).toMatch(/detectKernels:\s*\(\)\s*=>/);
    expect(globalSource).toMatch(/detectKernels\(\):\s*Promise</);
    expect(globalSource).toContain('KernelDetectResponse');
  });
});
