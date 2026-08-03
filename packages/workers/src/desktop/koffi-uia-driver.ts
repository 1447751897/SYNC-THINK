import { createHash } from 'node:crypto';
import type {
  DesktopAccessibilitySnapshot,
  DesktopAction,
  DesktopActionResult,
  DesktopElementSnapshot,
  DesktopElementTarget,
  DesktopProbeResult,
  DesktopSelector,
  DesktopSnapshotTarget,
  DesktopTreeLimits,
  DesktopWindowIdentity,
  DesktopWindowListResult,
} from './desktop-contract.js';
import { normalizeDesktopTreeLimits } from './desktop-contract.js';
import { DesktopDriverError, type DesktopAutomationDriver } from './desktop-host-runtime.js';
import { KoffiWindowsUiaBackend } from './windows-uia-backend.js';

export interface WindowsUiaInspection {
  window: DesktopWindowIdentity;
  elements: DesktopElementSnapshot[];
  truncated: boolean;
}

export interface WindowsUiaElementLease {
  inspection: WindowsUiaInspection;
  element: DesktopElementSnapshot;
  readValue(): string;
  focus(): void;
  invoke(): void;
  setValue(value: string): void;
  dispose(): void;
}

export interface WindowsUiaBackend {
  probe(): DesktopProbeResult | Promise<DesktopProbeResult>;
  listWindows(): DesktopWindowListResult | Promise<DesktopWindowListResult>;
  inspectWindow(
    window: DesktopWindowIdentity,
    limits: DesktopTreeLimits,
  ): WindowsUiaInspection | Promise<WindowsUiaInspection>;
  acquireElement(
    window: DesktopWindowIdentity,
    limits: DesktopTreeLimits,
    elementIndex: number,
  ): WindowsUiaElementLease | Promise<WindowsUiaElementLease>;
}

type FencedElementAction = Extract<
  DesktopAction,
  { kind: 'read-element' | 'focus-element' | 'invoke-element' | 'set-value' }
>;

export class KoffiUiaDriver implements DesktopAutomationDriver {
  constructor(private readonly backend: WindowsUiaBackend = new KoffiWindowsUiaBackend()) {}

  async execute(action: DesktopAction): Promise<DesktopActionResult> {
    switch (action.kind) {
      case 'probe':
        return this.backend.probe();
      case 'list-windows':
        return this.backend.listWindows();
      case 'inspect-window':
        return createAccessibilitySnapshot(
          await this.backend.inspectWindow(
            action.window,
            normalizeDesktopTreeLimits(action.limits),
          ),
        );
      case 'resolve-selector':
        return resolveSelector(
          createAccessibilitySnapshot(
            await this.backend.inspectWindow(
              action.target.window,
              normalizeDesktopTreeLimits(action.limits),
            ),
          ),
          action.target,
          action.selector,
        );
      case 'read-element':
        return this.withFencedElement(action, (lease, element) => {
          if (element.supportedPatterns.includes('Value')) {
            return { kind: 'element-read', value: lease.readValue() };
          }
          if (element.name !== undefined) {
            return { kind: 'element-read', text: element.name };
          }
          throw patternUnsupported(
            'Desktop element exposes neither ValuePattern nor an auditable Name',
          );
        });
      case 'focus-element':
        return this.withFencedElement(action, (lease, element) => {
          assertElementInteractive(element, true);
          lease.focus();
          return { kind: 'action-completed' };
        });
      case 'invoke-element':
        return this.withFencedElement(action, (lease, element) => {
          assertElementInteractive(element, true);
          if (!element.supportedPatterns.includes('Invoke')) {
            throw patternUnsupported('Desktop element does not expose InvokePattern');
          }
          lease.invoke();
          return { kind: 'action-completed' };
        });
      case 'set-value':
        return this.withFencedElement(action, (lease, element) => {
          assertElementInteractive(element, false);
          if (!element.supportedPatterns.includes('Value')) {
            throw patternUnsupported('Desktop element does not expose ValuePattern');
          }
          lease.setValue(action.value);
          return { kind: 'action-completed' };
        });
    }
  }

  private async withFencedElement<T extends DesktopActionResult>(
    action: FencedElementAction,
    execute: (lease: WindowsUiaElementLease, element: DesktopElementSnapshot) => T,
  ): Promise<T> {
    const lease = await this.backend.acquireElement(
      action.target.window,
      normalizeDesktopTreeLimits(action.limits),
      action.target.elementIndex,
    );
    try {
      const snapshot = createAccessibilitySnapshot(lease.inspection);
      const element = assertElementFence(snapshot, action.target);
      return execute(lease, element);
    } finally {
      lease.dispose();
    }
  }
}

function resolveSelector(
  snapshot: DesktopAccessibilitySnapshot,
  expected: DesktopSnapshotTarget,
  selector: DesktopSelector,
): DesktopActionResult {
  assertSnapshotFence(snapshot, expected);

  const matches = snapshot.elements.filter((element) => matchesSelector(element, selector));
  if (matches.length === 0) {
    throw new DesktopDriverError(
      'desktop.selector-not-found',
      'Desktop selector did not match an element in the exact snapshot',
      'acceptance',
    );
  }
  if (matches.length > 1) {
    throw new DesktopDriverError(
      'desktop.selector-ambiguous',
      'Desktop selector matched multiple elements in the exact snapshot',
      'acceptance',
    );
  }

  const element = matches[0]!;
  return {
    kind: 'element-resolved',
    target: {
      window: snapshot.window,
      snapshotRevision: snapshot.snapshotRevision,
      accessibilityRevision: snapshot.accessibilityRevision,
      elementIndex: element.index,
    },
    element,
  };
}

function assertElementFence(
  snapshot: DesktopAccessibilitySnapshot,
  expected: DesktopElementTarget,
): DesktopElementSnapshot {
  assertSnapshotFence(snapshot, expected);
  const element = snapshot.elements.find((candidate) => candidate.index === expected.elementIndex);
  if (!element) {
    throw new DesktopDriverError(
      'desktop.element-not-found',
      'Desktop element index is not present in the exact accessibility snapshot',
      'acceptance',
    );
  }
  return element;
}

function assertSnapshotFence(
  snapshot: DesktopAccessibilitySnapshot,
  expected: DesktopSnapshotTarget,
): void {
  if (
    snapshot.snapshotRevision !== expected.snapshotRevision ||
    snapshot.accessibilityRevision !== expected.accessibilityRevision
  ) {
    throw new DesktopDriverError(
      'desktop.snapshot-stale',
      'Desktop accessibility snapshot is stale and must be inspected again',
      'acceptance',
    );
  }
}

function assertElementInteractive(element: DesktopElementSnapshot, rejectOffscreen: boolean): void {
  if (!element.enabled) {
    throw new DesktopDriverError(
      'desktop.element-disabled',
      'Desktop element is disabled and cannot accept this action',
      'acceptance',
    );
  }
  if (rejectOffscreen && element.offscreen) {
    throw new DesktopDriverError(
      'desktop.element-offscreen',
      'Desktop element is offscreen and cannot accept this action',
      'acceptance',
    );
  }
}

function patternUnsupported(message: string): DesktopDriverError {
  return new DesktopDriverError('desktop.pattern-unsupported', message, 'acceptance');
}

function matchesSelector(element: DesktopElementSnapshot, selector: DesktopSelector): boolean {
  if (selector.automationId !== undefined) {
    return (
      element.automationId === selector.automationId &&
      (selector.controlType === undefined || element.controlType === selector.controlType)
    );
  }
  return element.name === selector.name && element.controlType === selector.controlType;
}

export function createAccessibilitySnapshot(
  inspection: WindowsUiaInspection,
): DesktopAccessibilitySnapshot {
  const accessibilityRevision = `desktop-a11y-v1:${sha256(
    canonicalAccessibilityTree(inspection.elements, inspection.truncated),
  )}`;
  const rootBounds = inspection.elements[0]?.bounds ?? null;
  const snapshotRevision = `desktop-snapshot-v1:${sha256({
    window: canonicalWindowIdentity(inspection.window),
    rootBounds,
    accessibilityRevision,
  })}`;
  return {
    kind: 'accessibility-snapshot',
    window: inspection.window,
    snapshotRevision,
    accessibilityRevision,
    elements: inspection.elements,
    truncated: inspection.truncated,
  };
}

function canonicalAccessibilityTree(
  elements: DesktopElementSnapshot[],
  truncated: boolean,
): unknown {
  return {
    truncated,
    elements: elements.map((element) => ({
      index: element.index,
      parentIndex: element.parentIndex ?? null,
      name: element.name ?? null,
      automationId: element.automationId ?? null,
      controlType: element.controlType,
      processId: element.processId,
      enabled: element.enabled,
      offscreen: element.offscreen,
      isPassword: element.isPassword,
      bounds: element.bounds ?? null,
      supportedPatterns: [...element.supportedPatterns].sort(),
    })),
  };
}

function canonicalWindowIdentity(window: DesktopWindowIdentity): unknown {
  return {
    processId: window.processId,
    nativeWindowHandle: window.nativeWindowHandle.toLowerCase(),
    title: window.title ?? null,
    appId: window.appId ?? null,
  };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
