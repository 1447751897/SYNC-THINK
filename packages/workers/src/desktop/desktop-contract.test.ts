import { describe, expect, it } from 'vitest';
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  createDesktopHostRequest,
  parseDesktopHostRequest,
  parseDesktopHostResponse,
  type DesktopAction,
} from './desktop-contract.js';

describe('desktop host contract', () => {
  it('creates and parses a versioned probe request', () => {
    const request = createDesktopHostRequest('req-1', { kind: 'probe' });
    expect(request).toEqual({
      type: 'request',
      protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      requestId: 'req-1',
      action: { kind: 'probe' },
    });
    expect(parseDesktopHostRequest(request)).toEqual(request);
  });

  it('accepts a bounded application launch request and verified visible-window result', () => {
    const action: DesktopAction = { kind: 'launch-app', application: 'notepad.exe' };
    expect(parseDesktopHostRequest(createDesktopHostRequest('req-launch', action)).action).toEqual(
      action,
    );

    expect(
      parseDesktopHostResponse(
        {
          type: 'response',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-launch',
          ok: true,
          result: {
            kind: 'app-launched',
            window: {
              processId: 42,
              nativeWindowHandle: '0x000000000001002a',
              title: 'Untitled - Notepad',
              appId: 'notepad.exe',
            },
            reusedExistingWindow: false,
          },
        },
        'req-launch',
      ),
    ).toMatchObject({
      ok: true,
      result: { kind: 'app-launched', reusedExistingWindow: false },
    });
  });

  it('rejects application launch arguments, protocols, and non-executable targets', () => {
    for (const application of [
      '',
      'notepad.exe --help',
      'https://example.com/app.exe',
      'C:\\Windows\\System32\\notepad.com',
    ]) {
      expect(() =>
        parseDesktopHostRequest({
          type: 'request',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-launch-invalid',
          action: { kind: 'launch-app', application },
        }),
      ).toThrow(/desktop host request/i);
    }
  });

  it('requires an explicit truncation flag for window-list results', () => {
    expect(
      parseDesktopHostResponse(
        {
          type: 'response',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-list',
          ok: true,
          result: {
            kind: 'window-list',
            windows: [
              {
                processId: 42,
                nativeWindowHandle: '0x000000000001002a',
                title: 'Fixture',
              },
            ],
            truncated: false,
          },
        },
        'req-list',
      ),
    ).toMatchObject({
      ok: true,
      result: { kind: 'window-list', truncated: false },
    });

    expect(() =>
      parseDesktopHostResponse(
        {
          type: 'response',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-list-invalid',
          ok: true,
          result: { kind: 'window-list', windows: [] },
        },
        'req-list-invalid',
      ),
    ).toThrow(/response result/i);
  });

  it('requires exact snapshot revisions for element actions', () => {
    const action: DesktopAction = {
      kind: 'invoke-element',
      limits: { maxDepth: 4, maxNodes: 100, maxTextBytes: 8_192 },
      target: {
        window: { processId: 42, nativeWindowHandle: '0x000000000001002a' },
        snapshotRevision: 'snapshot-1',
        accessibilityRevision: 'accessibility-1',
        elementIndex: 7,
      },
    };
    expect(parseDesktopHostRequest(createDesktopHostRequest('req-2', action)).action).toEqual(
      action,
    );
  });

  it('rejects malformed window identities and stale-capable actions without revisions', () => {
    expect(() =>
      parseDesktopHostRequest({
        type: 'request',
        protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        requestId: 'req-3',
        action: {
          kind: 'invoke-element',
          target: {
            window: { processId: 0, nativeWindowHandle: '42' },
            elementIndex: -1,
          },
        },
      }),
    ).toThrow(/desktop host request/i);
  });

  it('accepts exact selector resolution requests and resolved element results', () => {
    const action: DesktopAction = {
      kind: 'resolve-selector',
      target: {
        window: { processId: 42, nativeWindowHandle: '0x000000000001002a' },
        snapshotRevision: 'snapshot-1',
        accessibilityRevision: 'accessibility-1',
      },
      selector: { automationId: 'ApplyButton' },
      limits: { maxDepth: 4, maxNodes: 100, maxTextBytes: 8_192 },
    };
    expect(
      parseDesktopHostRequest(createDesktopHostRequest('req-selector', action)).action,
    ).toEqual(action);

    expect(
      parseDesktopHostResponse(
        {
          type: 'response',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-selector-result',
          ok: true,
          result: {
            kind: 'element-resolved',
            target: {
              ...action.target,
              elementIndex: 1,
            },
            element: {
              index: 1,
              parentIndex: 0,
              name: 'Apply',
              automationId: 'ApplyButton',
              controlType: 'Button',
              processId: 42,
              enabled: true,
              offscreen: false,
              isPassword: false,
              supportedPatterns: ['Invoke'],
            },
          },
        },
        'req-selector-result',
      ),
    ).toMatchObject({ ok: true, result: { kind: 'element-resolved' } });
  });

  it('rejects selector requests that are neither automationId nor name plus controlType', () => {
    for (const selector of [{ name: 'Apply' }, { controlType: 'Button' }, {}]) {
      expect(() =>
        parseDesktopHostRequest({
          type: 'request',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-selector-invalid',
          action: {
            kind: 'resolve-selector',
            target: {
              window: { processId: 42, nativeWindowHandle: '0x000000000001002a' },
              snapshotRevision: 'snapshot-1',
              accessibilityRevision: 'accessibility-1',
            },
            selector,
          },
        }),
      ).toThrow(/desktop host request/i);
    }
  });

  it('accepts bounded semantic element actions and validates their results', () => {
    const target = {
      window: { processId: 42, nativeWindowHandle: '0x000000000001002a' },
      snapshotRevision: 'snapshot-1',
      accessibilityRevision: 'accessibility-1',
      elementIndex: 7,
    };
    for (const action of [
      { kind: 'read-element' as const, target, limits: { maxNodes: 50 } },
      { kind: 'focus-element' as const, target, limits: { maxDepth: 4 } },
      { kind: 'invoke-element' as const, target, limits: { maxTextBytes: 8_192 } },
      { kind: 'set-value' as const, target, value: 'updated', limits: { maxNodes: 50 } },
    ]) {
      expect(
        parseDesktopHostRequest(createDesktopHostRequest(`req-${action.kind}`, action)).action,
      ).toEqual(action);
    }

    expect(
      parseDesktopHostResponse(
        {
          type: 'response',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-read-result',
          ok: true,
          result: { kind: 'element-read', value: '' },
        },
        'req-read-result',
      ),
    ).toMatchObject({ ok: true, result: { kind: 'element-read', value: '' } });
    expect(
      parseDesktopHostResponse(
        {
          type: 'response',
          protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
          requestId: 'req-action-result',
          ok: true,
          result: { kind: 'action-completed' },
        },
        'req-action-result',
      ),
    ).toMatchObject({ ok: true, result: { kind: 'action-completed' } });
  });

  it('rejects malformed action limits and ambiguous read results', () => {
    expect(() =>
      parseDesktopHostRequest({
        type: 'request',
        protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        requestId: 'req-invalid-limits',
        action: {
          kind: 'read-element',
          target: {
            window: { processId: 42, nativeWindowHandle: '0x000000000001002a' },
            snapshotRevision: 'snapshot-1',
            accessibilityRevision: 'accessibility-1',
            elementIndex: 7,
          },
          limits: 'unbounded',
        },
      }),
    ).toThrow(/desktop host request/i);

    for (const result of [
      { kind: 'element-read' },
      { kind: 'element-read', value: 'value', text: 'text' },
    ]) {
      expect(() =>
        parseDesktopHostResponse(
          {
            type: 'response',
            protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
            requestId: 'req-invalid-read',
            ok: true,
            result,
          },
          'req-invalid-read',
        ),
      ).toThrow(/response result/i);
    }
  });
});
