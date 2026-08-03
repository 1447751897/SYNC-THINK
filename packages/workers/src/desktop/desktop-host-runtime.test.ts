import { describe, expect, it } from 'vitest';
import { createDesktopHostRequest } from './desktop-contract.js';
import {
  DesktopDriverError,
  executeDesktopHostRequest,
  type DesktopAutomationDriver,
} from './desktop-host-runtime.js';

const request = createDesktopHostRequest('req-runtime', { kind: 'probe' });

describe('desktop host runtime', () => {
  it('returns a versioned success envelope', async () => {
    const driver: DesktopAutomationDriver = {
      execute: async () => ({
        kind: 'probe',
        backend: 'uia-com',
        platform: 'win32',
        architecture: 'x64',
        rootAvailable: true,
      }),
    };
    await expect(executeDesktopHostRequest(request, driver)).resolves.toMatchObject({
      type: 'response',
      requestId: 'req-runtime',
      ok: true,
      result: { kind: 'probe', rootAvailable: true },
    });
  });

  it('keeps stable driver codes and failure classes', async () => {
    const driver: DesktopAutomationDriver = {
      execute: async () => {
        throw new DesktopDriverError(
          'desktop.action-unsupported',
          'Desktop action is not implemented in this P0 slice',
          'acceptance',
        );
      },
    };
    await expect(executeDesktopHostRequest(request, driver)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'desktop.action-unsupported',
        failureClass: 'acceptance',
      },
    });
  });

  it('scrubs unknown driver errors into a fixed host failure', async () => {
    const driver: DesktopAutomationDriver = {
      execute: async () => {
        throw new Error('raw native detail');
      },
    };
    await expect(executeDesktopHostRequest(request, driver)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'desktop.uia-unavailable',
        message: 'Windows UI Automation is unavailable',
        failureClass: 'crashed',
      },
    });
  });
});
