import { describe, expect, it, vi } from 'vitest';
import type {
  DesktopElementSnapshot,
  DesktopProbeResult,
  DesktopWindowIdentity,
  DesktopWindowListResult,
} from './desktop-contract.js';
import { KoffiUiaDriver, type WindowsUiaBackend } from './koffi-uia-driver.js';

const windowIdentity: DesktopWindowIdentity = {
  processId: 42,
  nativeWindowHandle: '0x000000000001002a',
  title: 'Fixture',
};

const elements: DesktopElementSnapshot[] = [
  {
    index: 0,
    name: 'Fixture',
    automationId: 'Root',
    controlType: 'Window',
    processId: 42,
    enabled: true,
    offscreen: false,
    isPassword: false,
    bounds: { x: 10, y: 20, width: 640, height: 480 },
    supportedPatterns: [],
  },
  {
    index: 1,
    parentIndex: 0,
    name: 'Apply',
    automationId: 'ApplyButton',
    controlType: 'Button',
    processId: 42,
    enabled: true,
    offscreen: false,
    isPassword: false,
    bounds: { x: 30, y: 40, width: 80, height: 24 },
    supportedPatterns: ['Invoke'],
  },
];

function createBackend() {
  const probeResult: DesktopProbeResult = {
    kind: 'probe',
    backend: 'uia-com',
    platform: 'win32',
    architecture: 'x64',
    rootAvailable: true,
  };
  const windowList: DesktopWindowListResult = {
    kind: 'window-list',
    windows: [windowIdentity],
    truncated: false,
  };
  const inspection = {
    window: windowIdentity,
    elements,
    truncated: false,
  };
  return {
    probe: vi.fn(() => probeResult),
    listWindows: vi.fn(() => windowList),
    launchApp: vi.fn(() => ({
      kind: 'app-launched' as const,
      window: { ...windowIdentity, appId: 'notepad.exe' },
      reusedExistingWindow: false,
    })),
    inspectWindow: vi.fn(() => inspection),
    acquireElement: vi.fn((_window, _limits, elementIndex) => ({
      inspection,
      element: elements[elementIndex]!,
      readValue: vi.fn(() => 'draft'),
      focus: vi.fn(),
      invoke: vi.fn(),
      setValue: vi.fn(),
      dispose: vi.fn(),
    })),
  } satisfies WindowsUiaBackend;
}

describe('KoffiUiaDriver', () => {
  it('launches an application only through the backend visible-window verifier', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);

    await expect(
      driver.execute({ kind: 'launch-app', application: 'notepad.exe' }),
    ).resolves.toEqual({
      kind: 'app-launched',
      window: { ...windowIdentity, appId: 'notepad.exe' },
      reusedExistingWindow: false,
    });
    expect(backend.launchApp).toHaveBeenCalledWith('notepad.exe');
  });

  it('routes list-windows through an injectable backend', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);

    await expect(driver.execute({ kind: 'list-windows' })).resolves.toEqual({
      kind: 'window-list',
      windows: [windowIdentity],
      truncated: false,
    });
    expect(backend.listWindows).toHaveBeenCalledOnce();
  });

  it('normalizes inspect limits and emits deterministic revisions', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const action = {
      kind: 'inspect-window' as const,
      window: windowIdentity,
      limits: { maxDepth: 3, maxNodes: 25, maxTextBytes: 4_096 },
    };

    const first = await driver.execute(action);
    const second = await driver.execute(action);

    expect(backend.inspectWindow).toHaveBeenNthCalledWith(1, windowIdentity, {
      maxDepth: 3,
      maxNodes: 25,
      maxTextBytes: 4_096,
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: 'accessibility-snapshot',
      window: windowIdentity,
      elements,
      truncated: false,
      accessibilityRevision: expect.stringMatching(/^desktop-a11y-v1:[0-9a-f]{64}$/),
      snapshotRevision: expect.stringMatching(/^desktop-snapshot-v1:[0-9a-f]{64}$/),
    });
  });

  it('changes revisions when accessibility content changes', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const first = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    backend.inspectWindow.mockReturnValueOnce({
      window: windowIdentity,
      elements: [{ ...elements[0]!, name: 'Changed' }],
      truncated: false,
    });
    const second = await driver.execute({ kind: 'inspect-window', window: windowIdentity });

    expect(first.kind).toBe('accessibility-snapshot');
    expect(second.kind).toBe('accessibility-snapshot');
    if (first.kind !== 'accessibility-snapshot' || second.kind !== 'accessibility-snapshot') return;
    expect(second.accessibilityRevision).not.toBe(first.accessibilityRevision);
    expect(second.snapshotRevision).not.toBe(first.snapshotRevision);
  });

  it('resolves an exact automationId against the fenced snapshot', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const snapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (snapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');

    await expect(
      driver.execute({
        kind: 'resolve-selector',
        target: {
          window: windowIdentity,
          snapshotRevision: snapshot.snapshotRevision,
          accessibilityRevision: snapshot.accessibilityRevision,
        },
        selector: { automationId: 'ApplyButton' },
      }),
    ).resolves.toEqual({
      kind: 'element-resolved',
      target: {
        window: windowIdentity,
        snapshotRevision: snapshot.snapshotRevision,
        accessibilityRevision: snapshot.accessibilityRevision,
        elementIndex: 1,
      },
      element: elements[1],
    });
  });

  it('falls back to exact name plus controlType when automationId is absent', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const snapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (snapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');

    await expect(
      driver.execute({
        kind: 'resolve-selector',
        target: {
          window: windowIdentity,
          snapshotRevision: snapshot.snapshotRevision,
          accessibilityRevision: snapshot.accessibilityRevision,
        },
        selector: { name: 'Apply', controlType: 'Button' },
      }),
    ).resolves.toMatchObject({
      kind: 'element-resolved',
      target: { elementIndex: 1 },
      element: elements[1],
    });
  });

  it('does not guess when a selector is missing or ambiguous', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const snapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (snapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');
    const target = {
      window: windowIdentity,
      snapshotRevision: snapshot.snapshotRevision,
      accessibilityRevision: snapshot.accessibilityRevision,
    };

    await expect(
      driver.execute({
        kind: 'resolve-selector',
        target,
        selector: { automationId: 'Missing' },
      }),
    ).rejects.toMatchObject({
      code: 'desktop.selector-not-found',
      failureClass: 'acceptance',
    });

    backend.inspectWindow.mockReturnValueOnce({
      window: windowIdentity,
      elements: [elements[0]!, elements[1]!, { ...elements[1]!, index: 2 }],
      truncated: false,
    });
    const ambiguousSnapshot = await driver.execute({
      kind: 'inspect-window',
      window: windowIdentity,
    });
    if (ambiguousSnapshot.kind !== 'accessibility-snapshot') {
      throw new Error('expected snapshot');
    }
    backend.inspectWindow.mockReturnValueOnce({
      window: windowIdentity,
      elements: [elements[0]!, elements[1]!, { ...elements[1]!, index: 2 }],
      truncated: false,
    });

    await expect(
      driver.execute({
        kind: 'resolve-selector',
        target: {
          window: windowIdentity,
          snapshotRevision: ambiguousSnapshot.snapshotRevision,
          accessibilityRevision: ambiguousSnapshot.accessibilityRevision,
        },
        selector: { automationId: 'ApplyButton' },
      }),
    ).rejects.toMatchObject({
      code: 'desktop.selector-ambiguous',
      failureClass: 'acceptance',
    });
  });

  it('rejects selector resolution when either snapshot revision is stale', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const snapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (snapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');

    for (const target of [
      {
        window: windowIdentity,
        snapshotRevision: `${snapshot.snapshotRevision}-stale`,
        accessibilityRevision: snapshot.accessibilityRevision,
      },
      {
        window: windowIdentity,
        snapshotRevision: snapshot.snapshotRevision,
        accessibilityRevision: `${snapshot.accessibilityRevision}-stale`,
      },
    ]) {
      await expect(
        driver.execute({
          kind: 'resolve-selector',
          target,
          selector: { automationId: 'ApplyButton' },
        }),
      ).rejects.toMatchObject({
        code: 'desktop.snapshot-stale',
        failureClass: 'acceptance',
      });
    }
  });

  it('reads ValuePattern values and falls back to an auditable Name', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const valueElements = [
      elements[0]!,
      {
        ...elements[1]!,
        name: 'Draft',
        automationId: 'InputText',
        controlType: 'Edit',
        supportedPatterns: ['Value'],
      },
    ];
    backend.inspectWindow.mockReturnValue({
      window: windowIdentity,
      elements: valueElements,
      truncated: false,
    });
    const snapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (snapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');
    const lease = {
      inspection: { window: windowIdentity, elements: valueElements, truncated: false },
      element: valueElements[1]!,
      readValue: vi.fn(() => 'draft'),
      focus: vi.fn(),
      invoke: vi.fn(),
      setValue: vi.fn(),
      dispose: vi.fn(),
    };
    backend.acquireElement.mockReturnValueOnce(lease);

    await expect(
      driver.execute({
        kind: 'read-element',
        target: {
          window: windowIdentity,
          snapshotRevision: snapshot.snapshotRevision,
          accessibilityRevision: snapshot.accessibilityRevision,
          elementIndex: 1,
        },
      }),
    ).resolves.toEqual({ kind: 'element-read', value: 'draft' });
    expect(lease.readValue).toHaveBeenCalledOnce();
    expect(lease.dispose).toHaveBeenCalledOnce();

    const nameOnlyElements = [
      elements[0]!,
      { ...valueElements[1]!, name: 'Visible result', supportedPatterns: [] },
    ];
    backend.inspectWindow.mockReturnValueOnce({
      window: windowIdentity,
      elements: nameOnlyElements,
      truncated: false,
    });
    const nameSnapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (nameSnapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');
    const nameLease = {
      ...lease,
      inspection: { window: windowIdentity, elements: nameOnlyElements, truncated: false },
      element: nameOnlyElements[1]!,
      readValue: vi.fn(),
      dispose: vi.fn(),
    };
    backend.acquireElement.mockReturnValueOnce(nameLease);

    await expect(
      driver.execute({
        kind: 'read-element',
        target: {
          window: windowIdentity,
          snapshotRevision: nameSnapshot.snapshotRevision,
          accessibilityRevision: nameSnapshot.accessibilityRevision,
          elementIndex: 1,
        },
      }),
    ).resolves.toEqual({ kind: 'element-read', text: 'Visible result' });
    expect(nameLease.readValue).not.toHaveBeenCalled();
  });

  it('focuses, invokes, and sets values only after the exact element fence passes', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const actionElements = [
      elements[0]!,
      elements[1]!,
      {
        ...elements[1]!,
        index: 2,
        name: 'Input',
        automationId: 'InputText',
        controlType: 'Edit',
        supportedPatterns: ['Value'],
      },
    ];
    backend.inspectWindow.mockReturnValue({
      window: windowIdentity,
      elements: actionElements,
      truncated: false,
    });
    const snapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (snapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');
    const target = {
      window: windowIdentity,
      snapshotRevision: snapshot.snapshotRevision,
      accessibilityRevision: snapshot.accessibilityRevision,
      elementIndex: 1,
    };
    const buttonLease = {
      inspection: { window: windowIdentity, elements: actionElements, truncated: false },
      element: actionElements[1]!,
      readValue: vi.fn(() => ''),
      focus: vi.fn(),
      invoke: vi.fn(),
      setValue: vi.fn(),
      dispose: vi.fn(),
    };
    const inputLease = {
      ...buttonLease,
      element: actionElements[2]!,
      focus: vi.fn(),
      invoke: vi.fn(),
      setValue: vi.fn(),
      dispose: vi.fn(),
    };
    backend.acquireElement
      .mockReturnValueOnce(buttonLease)
      .mockReturnValueOnce(buttonLease)
      .mockReturnValueOnce(inputLease);

    await expect(driver.execute({ kind: 'focus-element', target })).resolves.toEqual({
      kind: 'action-completed',
    });
    await expect(driver.execute({ kind: 'invoke-element', target })).resolves.toEqual({
      kind: 'action-completed',
    });
    await expect(
      driver.execute({
        kind: 'set-value',
        target: { ...target, elementIndex: 2 },
        value: 'updated through stdin',
        limits: { maxDepth: 5, maxNodes: 50, maxTextBytes: 8_192 },
      }),
    ).resolves.toEqual({ kind: 'action-completed' });

    expect(buttonLease.focus).toHaveBeenCalledOnce();
    expect(buttonLease.invoke).toHaveBeenCalledOnce();
    expect(inputLease.setValue).toHaveBeenCalledWith('updated through stdin');
    expect(backend.acquireElement).toHaveBeenLastCalledWith(
      windowIdentity,
      { maxDepth: 5, maxNodes: 50, maxTextBytes: 8_192 },
      2,
    );
  });

  it('rejects stale, unavailable, and unsupported element actions without side effects', async () => {
    const backend = createBackend();
    const driver = new KoffiUiaDriver(backend);
    const snapshot = await driver.execute({ kind: 'inspect-window', window: windowIdentity });
    if (snapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');
    const baseTarget = {
      window: windowIdentity,
      snapshotRevision: snapshot.snapshotRevision,
      accessibilityRevision: snapshot.accessibilityRevision,
      elementIndex: 1,
    };
    const staleLease = backend.acquireElement(
      windowIdentity,
      {
        maxDepth: 12,
        maxNodes: 2_000,
        maxTextBytes: 256 * 1024,
      },
      1,
    );
    staleLease.inspection = {
      window: windowIdentity,
      elements: [{ ...elements[0]!, name: 'Changed' }, elements[1]!],
      truncated: false,
    };
    backend.acquireElement.mockReturnValueOnce(staleLease);

    await expect(
      driver.execute({ kind: 'invoke-element', target: baseTarget }),
    ).rejects.toMatchObject({
      code: 'desktop.snapshot-stale',
      failureClass: 'acceptance',
    });
    expect(staleLease.invoke).not.toHaveBeenCalled();
    expect(staleLease.dispose).toHaveBeenCalledOnce();

    for (const [element, action, code] of [
      [{ ...elements[1]!, enabled: false }, 'focus-element', 'desktop.element-disabled'],
      [{ ...elements[1]!, offscreen: true }, 'focus-element', 'desktop.element-offscreen'],
      [{ ...elements[1]!, supportedPatterns: [] }, 'invoke-element', 'desktop.pattern-unsupported'],
    ] as const) {
      const fencedElements = [elements[0]!, element];
      backend.inspectWindow.mockReturnValueOnce({
        window: windowIdentity,
        elements: fencedElements,
        truncated: false,
      });
      const fencedSnapshot = await driver.execute({
        kind: 'inspect-window',
        window: windowIdentity,
      });
      if (fencedSnapshot.kind !== 'accessibility-snapshot') throw new Error('expected snapshot');
      const lease = {
        inspection: { window: windowIdentity, elements: fencedElements, truncated: false },
        element,
        readValue: vi.fn(() => ''),
        focus: vi.fn(),
        invoke: vi.fn(),
        setValue: vi.fn(),
        dispose: vi.fn(),
      };
      backend.acquireElement.mockReturnValueOnce(lease);
      await expect(
        driver.execute({
          kind: action,
          target: {
            window: windowIdentity,
            snapshotRevision: fencedSnapshot.snapshotRevision,
            accessibilityRevision: fencedSnapshot.accessibilityRevision,
            elementIndex: 1,
          },
        }),
      ).rejects.toMatchObject({ code, failureClass: 'acceptance' });
      expect(lease.focus).not.toHaveBeenCalled();
      expect(lease.invoke).not.toHaveBeenCalled();
      expect(lease.dispose).toHaveBeenCalledOnce();
    }
  });
});
