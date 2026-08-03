export const DESKTOP_HOST_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_DESKTOP_TREE_LIMITS: DesktopTreeLimits = {
  maxDepth: 12,
  maxNodes: 2_000,
  maxTextBytes: 256 * 1024,
};

export interface DesktopWindowIdentity {
  processId: number;
  nativeWindowHandle: string;
  title?: string;
  appId?: string;
}

export interface DesktopBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopTreeLimits {
  maxDepth: number;
  maxNodes: number;
  maxTextBytes: number;
}

export type DesktopSelector =
  | { automationId: string; controlType?: string; name?: never }
  | { automationId?: never; name: string; controlType: string };

export interface DesktopSnapshotTarget {
  window: DesktopWindowIdentity;
  snapshotRevision: string;
  accessibilityRevision: string;
}

export interface DesktopElementTarget extends DesktopSnapshotTarget {
  elementIndex: number;
}

export interface DesktopElementSnapshot {
  index: number;
  parentIndex?: number;
  name?: string;
  automationId?: string;
  controlType: string;
  processId: number;
  enabled: boolean;
  offscreen: boolean;
  isPassword: boolean;
  bounds?: DesktopBounds;
  supportedPatterns: string[];
}

export interface DesktopAccessibilitySnapshot {
  kind: 'accessibility-snapshot';
  window: DesktopWindowIdentity;
  snapshotRevision: string;
  accessibilityRevision: string;
  elements: DesktopElementSnapshot[];
  truncated: boolean;
}

export type DesktopAction =
  | { kind: 'probe' }
  | { kind: 'list-windows' }
  | { kind: 'inspect-window'; window: DesktopWindowIdentity; limits?: Partial<DesktopTreeLimits> }
  | {
      kind: 'resolve-selector';
      target: DesktopSnapshotTarget;
      selector: DesktopSelector;
      limits?: Partial<DesktopTreeLimits>;
    }
  | {
      kind: 'read-element';
      target: DesktopElementTarget;
      limits?: Partial<DesktopTreeLimits>;
    }
  | {
      kind: 'focus-element';
      target: DesktopElementTarget;
      limits?: Partial<DesktopTreeLimits>;
    }
  | {
      kind: 'invoke-element';
      target: DesktopElementTarget;
      limits?: Partial<DesktopTreeLimits>;
    }
  | {
      kind: 'set-value';
      target: DesktopElementTarget;
      value: string;
      limits?: Partial<DesktopTreeLimits>;
    };

export interface DesktopProbeResult {
  kind: 'probe';
  backend: 'uia-com';
  platform: NodeJS.Platform;
  architecture: string;
  rootAvailable: boolean;
  koffiVersion?: string;
  napiVersion?: string;
  elapsedMs?: number;
}

export interface DesktopWindowListResult {
  kind: 'window-list';
  windows: DesktopWindowIdentity[];
  truncated: boolean;
}

export interface DesktopElementResolvedResult {
  kind: 'element-resolved';
  target: DesktopElementTarget;
  element: DesktopElementSnapshot;
}

export interface DesktopElementReadResult {
  kind: 'element-read';
  value?: string;
  text?: string;
}

export interface DesktopActionCompletedResult {
  kind: 'action-completed';
}

export type DesktopActionResult =
  | DesktopProbeResult
  | DesktopWindowListResult
  | DesktopAccessibilitySnapshot
  | DesktopElementResolvedResult
  | DesktopElementReadResult
  | DesktopActionCompletedResult;

export interface DesktopHostRequest {
  type: 'request';
  protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  requestId: string;
  action: DesktopAction;
}

export interface DesktopHostReady {
  type: 'ready';
  protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  pid: number;
}

export interface DesktopHostSuccessResponse {
  type: 'response';
  protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  requestId: string;
  ok: true;
  result: DesktopActionResult;
}

export interface DesktopHostFailureResponse {
  type: 'response';
  protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
    failureClass: 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';
  };
}

export type DesktopHostResponse = DesktopHostSuccessResponse | DesktopHostFailureResponse;

export function createDesktopHostRequest(
  requestId: string,
  action: DesktopAction,
): DesktopHostRequest {
  return parseDesktopHostRequest({
    type: 'request',
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    requestId,
    action,
  });
}

export function parseDesktopHostRequest(value: unknown): DesktopHostRequest {
  if (!isRecord(value) || value.type !== 'request') invalidRequest();
  if (value.protocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION) invalidRequest();
  if (!isNonEmptyString(value.requestId, 128)) invalidRequest();
  validateAction(value.action);
  return value as unknown as DesktopHostRequest;
}

export function parseDesktopHostReady(value: unknown): DesktopHostReady {
  if (
    !isRecord(value) ||
    value.type !== 'ready' ||
    value.protocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION ||
    !Number.isSafeInteger(value.pid) ||
    Number(value.pid) <= 0
  ) {
    throw new Error('Invalid desktop host ready handshake');
  }
  return value as unknown as DesktopHostReady;
}

export function parseDesktopHostResponse(value: unknown, requestId: string): DesktopHostResponse {
  if (
    !isRecord(value) ||
    value.type !== 'response' ||
    value.protocolVersion !== DESKTOP_HOST_PROTOCOL_VERSION ||
    value.requestId !== requestId ||
    typeof value.ok !== 'boolean'
  ) {
    throw new Error('Invalid desktop host response');
  }
  if (value.ok) {
    try {
      validateActionResult(value.result);
    } catch {
      throw new Error('Invalid desktop host response result');
    }
  } else if (
    !isRecord(value.error) ||
    !isNonEmptyString(value.error.code, 128) ||
    !isNonEmptyString(value.error.message, 2_048) ||
    !isFailureClass(value.error.failureClass)
  ) {
    throw new Error('Invalid desktop host response error');
  }
  return value as unknown as DesktopHostResponse;
}

export function normalizeDesktopTreeLimits(
  limits: Partial<DesktopTreeLimits> | undefined,
): DesktopTreeLimits {
  return {
    maxDepth: boundedInteger(limits?.maxDepth, DEFAULT_DESKTOP_TREE_LIMITS.maxDepth, 1, 32),
    maxNodes: boundedInteger(limits?.maxNodes, DEFAULT_DESKTOP_TREE_LIMITS.maxNodes, 1, 10_000),
    maxTextBytes: boundedInteger(
      limits?.maxTextBytes,
      DEFAULT_DESKTOP_TREE_LIMITS.maxTextBytes,
      1_024,
      1024 * 1024,
    ),
  };
}

function validateActionResult(value: unknown): asserts value is DesktopActionResult {
  if (!isRecord(value) || !isNonEmptyString(value.kind, 64)) invalidRequest();
  switch (value.kind) {
    case 'probe':
      if (
        value.backend !== 'uia-com' ||
        typeof value.platform !== 'string' ||
        !isNonEmptyString(value.architecture, 64) ||
        typeof value.rootAvailable !== 'boolean'
      ) {
        invalidRequest();
      }
      return;
    case 'window-list':
      if (!Array.isArray(value.windows) || value.windows.length > 256) invalidRequest();
      for (const window of value.windows) validateWindow(window);
      if (typeof value.truncated !== 'boolean') invalidRequest();
      return;
    case 'accessibility-snapshot':
      validateWindow(value.window);
      if (!isNonEmptyString(value.snapshotRevision, 128)) invalidRequest();
      if (!isNonEmptyString(value.accessibilityRevision, 128)) invalidRequest();
      if (!Array.isArray(value.elements) || value.elements.length > 10_000) invalidRequest();
      if (typeof value.truncated !== 'boolean') invalidRequest();
      return;
    case 'element-resolved':
      validateTarget(value.target);
      validateElementSnapshot(value.element);
      if (value.element.index !== value.target.elementIndex) invalidRequest();
      return;
    case 'element-read': {
      const hasValue = typeof value.value === 'string';
      const hasText = typeof value.text === 'string';
      if (hasValue === hasText) invalidRequest();
      return;
    }
    case 'action-completed':
      return;
    default:
      invalidRequest();
  }
}

function validateAction(value: unknown): asserts value is DesktopAction {
  if (!isRecord(value) || !isNonEmptyString(value.kind, 64)) invalidRequest();
  switch (value.kind) {
    case 'probe':
    case 'list-windows':
      return;
    case 'inspect-window':
      validateWindow(value.window);
      validateTreeLimits(value.limits);
      return;
    case 'resolve-selector':
      validateSnapshotTarget(value.target);
      validateSelector(value.selector);
      validateTreeLimits(value.limits);
      return;
    case 'read-element':
    case 'focus-element':
    case 'invoke-element':
      validateTarget(value.target);
      validateTreeLimits(value.limits);
      return;
    case 'set-value':
      validateTarget(value.target);
      validateTreeLimits(value.limits);
      if (typeof value.value !== 'string' || Buffer.byteLength(value.value, 'utf8') > 64 * 1024) {
        invalidRequest();
      }
      return;
    default:
      invalidRequest();
  }
}

function validateTreeLimits(value: unknown): void {
  if (value !== undefined && !isRecord(value)) invalidRequest();
  normalizeDesktopTreeLimits(value as Partial<DesktopTreeLimits> | undefined);
}

function validateTarget(value: unknown): asserts value is DesktopElementTarget {
  validateSnapshotTarget(value);
  if (
    !('elementIndex' in value) ||
    !Number.isSafeInteger(value.elementIndex) ||
    Number(value.elementIndex) < 0
  ) {
    invalidRequest();
  }
}

function validateSnapshotTarget(value: unknown): asserts value is DesktopSnapshotTarget {
  if (!isRecord(value)) invalidRequest();
  validateWindow(value.window);
  if (!isNonEmptyString(value.snapshotRevision, 128)) invalidRequest();
  if (!isNonEmptyString(value.accessibilityRevision, 128)) invalidRequest();
}

function validateSelector(value: unknown): asserts value is DesktopSelector {
  if (!isRecord(value)) invalidRequest();
  if (value.automationId !== undefined) {
    if (!isNonEmptyString(value.automationId, 4_096)) invalidRequest();
    if (value.name !== undefined) invalidRequest();
    if (value.controlType !== undefined && !isNonEmptyString(value.controlType, 128)) {
      invalidRequest();
    }
    return;
  }
  if (!isNonEmptyString(value.name, 4_096)) invalidRequest();
  if (!isNonEmptyString(value.controlType, 128)) invalidRequest();
}

function validateElementSnapshot(value: unknown): asserts value is DesktopElementSnapshot {
  if (!isRecord(value)) invalidRequest();
  if (!Number.isSafeInteger(value.index) || Number(value.index) < 0) invalidRequest();
  if (
    value.parentIndex !== undefined &&
    (!Number.isSafeInteger(value.parentIndex) || Number(value.parentIndex) < 0)
  ) {
    invalidRequest();
  }
  if (value.name !== undefined && typeof value.name !== 'string') invalidRequest();
  if (value.automationId !== undefined && typeof value.automationId !== 'string') invalidRequest();
  if (!isNonEmptyString(value.controlType, 128)) invalidRequest();
  if (!Number.isSafeInteger(value.processId) || Number(value.processId) <= 0) invalidRequest();
  if (
    typeof value.enabled !== 'boolean' ||
    typeof value.offscreen !== 'boolean' ||
    typeof value.isPassword !== 'boolean'
  )
    invalidRequest();
  if (!Array.isArray(value.supportedPatterns)) invalidRequest();
  if (!value.supportedPatterns.every((pattern) => isNonEmptyString(pattern, 128))) invalidRequest();
}

function validateWindow(value: unknown): asserts value is DesktopWindowIdentity {
  if (!isRecord(value)) invalidRequest();
  if (!Number.isSafeInteger(value.processId) || Number(value.processId) <= 0) invalidRequest();
  if (
    typeof value.nativeWindowHandle !== 'string' ||
    !/^0x[0-9a-f]{1,16}$/i.test(value.nativeWindowHandle)
  ) {
    invalidRequest();
  }
  if (value.title !== undefined && !isNonEmptyString(value.title, 1_024)) invalidRequest();
  if (value.appId !== undefined && !isNonEmptyString(value.appId, 2_048)) invalidRequest();
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalidRequest();
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isFailureClass(
  value: unknown,
): value is 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown' {
  return ['timeout', 'crashed', 'permission', 'acceptance', 'unknown'].includes(String(value));
}

function invalidRequest(): never {
  throw new Error('Invalid desktop host request');
}
