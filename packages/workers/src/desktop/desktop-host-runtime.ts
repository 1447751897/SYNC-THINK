import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  type DesktopAction,
  type DesktopActionResult,
  type DesktopHostRequest,
  type DesktopHostResponse,
} from './desktop-contract.js';

export type DesktopDriverFailureClass =
  'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';

export class DesktopDriverError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly failureClass: DesktopDriverFailureClass,
  ) {
    super(message);
    this.name = 'DesktopDriverError';
  }
}

export interface DesktopAutomationDriver {
  execute(action: DesktopAction): Promise<DesktopActionResult>;
}

export async function executeDesktopHostRequest(
  request: DesktopHostRequest,
  driver: DesktopAutomationDriver,
): Promise<DesktopHostResponse> {
  try {
    return {
      type: 'response',
      protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: await driver.execute(request.action),
    };
  } catch (error) {
    const failure =
      error instanceof DesktopDriverError
        ? error
        : new DesktopDriverError(
            'desktop.uia-unavailable',
            'Windows UI Automation is unavailable',
            'crashed',
          );
    return {
      type: 'response',
      protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        failureClass: failure.failureClass,
      },
    };
  }
}
