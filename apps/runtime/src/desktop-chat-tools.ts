import { createHash, randomUUID } from 'node:crypto';
import type { ProviderToolCall, ProviderToolSchema } from '@sync-think/adapters';
import { ErrorCode, type HumanOnlyAction } from '@sync-think/shared';
import {
  IsolatedDesktopWorker,
  createDesktopHostRequest,
  type DesktopAction,
  type DesktopElementSnapshot,
  type DesktopElementTarget,
  type DesktopSelector,
  type DesktopSnapshotTarget,
  type DesktopTreeLimits,
  type DesktopWindowIdentity,
  type DesktopWorker,
  type DesktopWorkerOutput,
  type WorkerEvent,
  type WorkerToken,
} from '@sync-think/workers';

const WINDOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['processId', 'nativeWindowHandle'],
  properties: {
    processId: { type: 'integer', minimum: 1 },
    nativeWindowHandle: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    appId: { type: 'string', minLength: 1 },
  },
} as const;

const LIMITS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    maxDepth: { type: 'integer', minimum: 1, maximum: 32 },
    maxNodes: { type: 'integer', minimum: 1, maximum: 10_000 },
    maxTextBytes: { type: 'integer', minimum: 1_024, maximum: 1_048_576 },
  },
} as const;

const SNAPSHOT_TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['window', 'snapshotRevision', 'accessibilityRevision'],
  properties: {
    window: WINDOW_SCHEMA,
    snapshotRevision: { type: 'string', minLength: 1 },
    accessibilityRevision: { type: 'string', minLength: 1 },
  },
} as const;

const ELEMENT_TARGET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['window', 'snapshotRevision', 'accessibilityRevision', 'elementIndex'],
  properties: {
    window: WINDOW_SCHEMA,
    snapshotRevision: { type: 'string', minLength: 1 },
    accessibilityRevision: { type: 'string', minLength: 1 },
    elementIndex: { type: 'integer', minimum: 0 },
  },
} as const;

export const CHAT_DESKTOP_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'desktop_list_windows',
    description:
      'List visible top-level Windows application windows. Start here before any desktop inspection or action.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'desktop_launch_app',
    description:
      'Launch one Windows .exe through the desktop host and return only after a matching visible top-level window is verified. Pass only an executable name such as notepad.exe or an absolute .exe path; command arguments and URLs are not accepted. Use this instead of run_command for GUI applications.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['application'],
      properties: { application: { type: 'string', minLength: 1, maxLength: 1_024 } },
    },
  },
  {
    name: 'desktop_inspect_window',
    description:
      'Inspect one exact window with bounded Windows UI Automation. Returns revisions and indexed elements. Use the exact window identity returned by desktop_list_windows.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['window'],
      properties: { window: WINDOW_SCHEMA, limits: LIMITS_SCHEMA },
    },
  },
  {
    name: 'desktop_resolve_selector',
    description:
      'Resolve exactly one UIA element from a fresh desktop_inspect_window snapshot. Use automationId (optionally controlType), or name plus controlType. Returns a fenced element target for one immediate read/action.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target', 'selector'],
      properties: {
        target: SNAPSHOT_TARGET_SCHEMA,
        selector: {
          type: 'object',
          additionalProperties: false,
          properties: {
            automationId: { type: 'string', minLength: 1 },
            name: { type: 'string', minLength: 1 },
            controlType: { type: 'string', minLength: 1 },
          },
        },
        limits: LIMITS_SCHEMA,
      },
    },
  },
  {
    name: 'desktop_read_element',
    description:
      'Read one freshly resolved UIA element. Re-resolve after the UI changes; stale revisions fail instead of guessing.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target'],
      properties: { target: ELEMENT_TARGET_SCHEMA, limits: LIMITS_SCHEMA },
    },
  },
  {
    name: 'desktop_focus_element',
    description:
      'Focus one freshly resolved UIA element using SetFocus. This is a visible desktop side effect.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target'],
      properties: { target: ELEMENT_TARGET_SCHEMA, limits: LIMITS_SCHEMA },
    },
  },
  {
    name: 'desktop_invoke_element',
    description:
      'Invoke one freshly resolved UIA element through Invoke Pattern. This is a visible desktop side effect.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target'],
      properties: { target: ELEMENT_TARGET_SCHEMA, limits: LIMITS_SCHEMA },
    },
  },
  {
    name: 'desktop_set_value',
    description:
      'Set the value of one freshly resolved editable UIA element through Value Pattern. The value is sent over Host stdin, not process arguments.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['target', 'value'],
      properties: {
        target: ELEMENT_TARGET_SCHEMA,
        value: { type: 'string', maxLength: 65_536 },
        limits: LIMITS_SCHEMA,
      },
    },
  },
];

export const CHAT_DESKTOP_TOOL_NAMES = new Set(CHAT_DESKTOP_TOOL_SCHEMAS.map((tool) => tool.name));
export const CHAT_DESKTOP_MUTATING_TOOL_NAMES = new Set([
  'desktop_launch_app',
  'desktop_focus_element',
  'desktop_invoke_element',
  'desktop_set_value',
]);

export interface PreparedChatDesktopTool {
  action: DesktopAction;
  sanitizedArgs: Record<string, unknown>;
  targetIdentity: string;
  mutating: boolean;
}

export type DesktopActionRiskLevel =
  'observe' | 'display' | 'sensitive' | 'human-only' | 'prohibited';

export interface DesktopActionRiskAssessment {
  level: DesktopActionRiskLevel;
  reasonCodes: string[];
  humanOnlyAction?: HumanOnlyAction;
  approvalArguments: Record<string, unknown>;
}

const HUMAN_ONLY_TARGET_PATTERNS: ReadonlyArray<{
  action: HumanOnlyAction;
  pattern: RegExp;
}> = [
  {
    action: 'payment-or-purchase',
    pattern:
      /(?:\b(?:pay|purchase|buy|checkout|place[-_ ]?order)\b|\u652f\u4ed8|\u4ed8\u6b3e|\u8d2d\u4e70|\u4e0b\u5355)/iu,
  },
  {
    action: 'public-publishing',
    pattern:
      /(?:\b(?:publish|post[-_ ]?publicly|make[-_ ]?public)\b|\u516c\u5f00\u53d1\u5e03|\u53d1\u5e03\u5230\u516c\u5f00)/iu,
  },
  {
    action: 'send-external-message-as-user',
    pattern:
      /(?:\b(?:send|reply|forward|submit[-_ ]?message|send[-_ ]?email)\b|\u53d1\u9001|\u56de\u590d|\u8f6c\u53d1|\u5916\u53d1)/iu,
  },
  {
    action: 'change-identity-or-permission-policy',
    pattern:
      /(?:\b(?:permission|role|administrator|admin[-_ ]?access|access[-_ ]?policy|identity[-_ ]?policy)\b|\u6743\u9650|\u89d2\u8272|\u7ba1\u7406\u5458|\u8eab\u4efd\u7b56\u7565)/iu,
  },
  {
    action: 'irreversible-deletion',
    pattern:
      /(?:\b(?:delete|erase|remove[-_ ]?permanently|permanent[-_ ]?delete)\b|\u6c38\u4e45\u5220\u9664|\u5f7b\u5e95\u5220\u9664|\u5220\u9664\u8d26\u6237|\u5220\u9664\u8d26\u53f7)/iu,
  },
  {
    action: 'export-sensitive-data-outside-boundary',
    pattern:
      /(?:\b(?:export|upload|share[-_ ]?externally|external[-_ ]?share)\b|\u5bfc\u51fa|\u4e0a\u4f20|\u5bf9\u5916\u5171\u4eab)/iu,
  },
];

export function assessChatDesktopToolRisk(
  prepared: PreparedChatDesktopTool,
  element?: DesktopElementSnapshot,
): DesktopActionRiskAssessment {
  const approvalArguments = projectDesktopApprovalArguments(prepared, element);
  const kind = prepared.action.kind;
  if (
    kind === 'probe' ||
    kind === 'list-windows' ||
    kind === 'inspect-window' ||
    kind === 'resolve-selector'
  ) {
    return { level: 'observe', reasonCodes: ['observation'], approvalArguments };
  }

  if (kind === 'launch-app') {
    return isTrustedDisplayApplication(prepared.action.application)
      ? { level: 'display', reasonCodes: ['trusted-app-launch'], approvalArguments }
      : { level: 'sensitive', reasonCodes: ['application-launch'], approvalArguments };
  }

  if (element?.isPassword && (kind === 'read-element' || kind === 'set-value')) {
    return {
      level: 'human-only',
      reasonCodes: ['password-field'],
      humanOnlyAction: 'access-or-create-secret',
      approvalArguments,
    };
  }

  if (kind !== 'focus-element') {
    const targetText = desktopRiskTargetText(prepared, element);
    const matched = HUMAN_ONLY_TARGET_PATTERNS.find(({ pattern }) => pattern.test(targetText));
    if (matched) {
      return {
        level: 'human-only',
        reasonCodes: ['human-only-target'],
        humanOnlyAction: matched.action,
        approvalArguments,
      };
    }
    if (
      /(?:\b(?:password|passcode|secret|api[-_ ]?key|access[-_ ]?token)\b|\u5bc6\u7801|\u53e3\u4ee4|\u5bc6\u94a5|\u4ee4\u724c)/iu.test(
        targetText,
      )
    ) {
      return {
        level: 'human-only',
        reasonCodes: ['secret-target'],
        humanOnlyAction: 'access-or-create-secret',
        approvalArguments,
      };
    }
  }

  if (kind === 'read-element') {
    return element
      ? { level: 'observe', reasonCodes: ['resolved-observation'], approvalArguments }
      : { level: 'sensitive', reasonCodes: ['target-metadata-unavailable'], approvalArguments };
  }
  if (kind === 'focus-element') {
    return { level: 'display', reasonCodes: ['visible-focus-change'], approvalArguments };
  }
  if (!element || element.isPassword === undefined) {
    return { level: 'sensitive', reasonCodes: ['target-metadata-unavailable'], approvalArguments };
  }
  return { level: 'display', reasonCodes: ['resolved-semantic-action'], approvalArguments };
}

export function desktopElementTargetIdentity(target: DesktopElementTarget): string {
  return JSON.stringify(target);
}

function projectDesktopApprovalArguments(
  prepared: PreparedChatDesktopTool,
  element?: DesktopElementSnapshot,
): Record<string, unknown> {
  const action = prepared.action;
  const window = desktopActionWindow(action);
  return {
    action: action.kind,
    ...(action.kind === 'launch-app' ? { application: action.application } : {}),
    ...(window?.title ? { windowTitle: window.title } : {}),
    ...(window?.appId ? { appId: window.appId } : {}),
    ...(element
      ? {
          element: {
            ...(element.name ? { name: element.name } : {}),
            ...(element.automationId ? { automationId: element.automationId } : {}),
            controlType: element.controlType,
            isPassword: element.isPassword,
          },
        }
      : {}),
    ...(action.kind === 'set-value' ? { valueLength: action.value.length } : {}),
  };
}

function desktopRiskTargetText(
  prepared: PreparedChatDesktopTool,
  element?: DesktopElementSnapshot,
): string {
  const action = prepared.action;
  const window = desktopActionWindow(action);
  return [
    action.kind === 'launch-app' ? action.application : undefined,
    window?.title,
    window?.appId,
    element?.name,
    element?.automationId,
    element?.controlType,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}

export function prepareChatDesktopTool(
  toolName: string,
  argumentsJson: string,
): PreparedChatDesktopTool | undefined {
  if (!CHAT_DESKTOP_TOOL_NAMES.has(toolName)) return undefined;
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(argumentsJson || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    args = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  try {
    args = normalizeOptionalDesktopStrings(args);
    const action = createDesktopHostRequest(
      'chat-desktop-validation',
      desktopActionForTool(toolName, args),
    ).action;
    return {
      action,
      sanitizedArgs: sanitizedDesktopArgs(action),
      targetIdentity: desktopTargetIdentity(action),
      mutating: CHAT_DESKTOP_MUTATING_TOOL_NAMES.has(toolName),
    };
  } catch {
    return undefined;
  }
}

function normalizeOptionalDesktopStrings(args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };
  if (typeof normalized.application === 'string') {
    normalized.application = normalized.application.trim();
  }
  if (isRecord(normalized.window)) normalized.window = normalizeWindowIdentity(normalized.window);
  if (isRecord(normalized.target)) {
    const target = { ...normalized.target };
    if (isRecord(target.window)) target.window = normalizeWindowIdentity(target.window);
    normalized.target = target;
  }
  if (isRecord(normalized.selector)) {
    normalized.selector = omitBlankOptionalStrings(normalized.selector, [
      'automationId',
      'name',
      'controlType',
    ]);
  }
  return normalized;
}

function normalizeWindowIdentity(window: Record<string, unknown>): Record<string, unknown> {
  return omitBlankOptionalStrings(window, ['title', 'appId']);
}

function omitBlankOptionalStrings(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const normalized = { ...value };
  for (const key of keys) {
    const field = normalized[key];
    if (typeof field === 'string' && field.trim().length === 0) delete normalized[key];
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function executeChatDesktopTool(input: {
  workspaceRoot?: string;
  toolCall: ProviderToolCall;
  capabilityEnabled: boolean;
  signal?: AbortSignal;
  worker?: DesktopWorker;
}): Promise<string> {
  if (!input.capabilityEnabled) {
    return JSON.stringify({
      ok: false,
      code: ErrorCode.DESKTOP_CAPABILITY_DISABLED,
      error: 'Computer Use plugin is disabled.',
    });
  }
  if (!CHAT_DESKTOP_TOOL_NAMES.has(input.toolCall.name)) {
    return JSON.stringify({ ok: false, error: `Unsupported desktop tool: ${input.toolCall.name}` });
  }
  const prepared = prepareChatDesktopTool(input.toolCall.name, input.toolCall.argumentsJson);
  if (!prepared) return invalidArguments();

  const workingDir = input.workspaceRoot?.trim() || process.cwd();
  const token: WorkerToken = {
    token: randomUUID(),
    allowedRoot: workingDir,
    timeoutMs: 30_000,
    maxOutputBytes: 1024 * 1024,
    signal: input.signal,
  };
  const worker = input.worker ?? new IsolatedDesktopWorker();
  return collectDesktopWorkerResult(worker.exec({ workingDir, action: prepared.action }, token));
}

function desktopActionForTool(toolName: string, args: Record<string, unknown>): DesktopAction {
  switch (toolName) {
    case 'desktop_list_windows':
      return { kind: 'list-windows' };
    case 'desktop_launch_app':
      return { kind: 'launch-app', application: args.application as string };
    case 'desktop_inspect_window':
      return {
        kind: 'inspect-window',
        window: args.window as DesktopWindowIdentity,
        limits: args.limits as Partial<DesktopTreeLimits>,
      };
    case 'desktop_resolve_selector':
      return {
        kind: 'resolve-selector',
        target: args.target as DesktopSnapshotTarget,
        selector: args.selector as DesktopSelector,
        limits: args.limits as Partial<DesktopTreeLimits>,
      };
    case 'desktop_read_element':
      return elementAction('read-element', args);
    case 'desktop_focus_element':
      return elementAction('focus-element', args);
    case 'desktop_invoke_element':
      return elementAction('invoke-element', args);
    case 'desktop_set_value':
      return {
        kind: 'set-value',
        target: args.target as DesktopElementTarget,
        value: args.value as string,
        limits: args.limits as Partial<DesktopTreeLimits>,
      };
    default:
      throw new Error('Unsupported desktop tool');
  }
}

function sanitizedDesktopArgs(action: DesktopAction): Record<string, unknown> {
  if (action.kind !== 'set-value') return action as unknown as Record<string, unknown>;
  return {
    kind: action.kind,
    target: action.target,
    limits: action.limits,
    valueLength: action.value.length,
    valueDigest: createHash('sha256').update(action.value).digest('hex'),
  };
}

function desktopTargetIdentity(action: DesktopAction): string {
  if (action.kind === 'probe' || action.kind === 'list-windows') return `desktop:${action.kind}`;
  if (action.kind === 'launch-app') {
    return `desktop:launch-app:${action.application.toLowerCase()}`;
  }
  const target = action.kind === 'inspect-window' ? { window: action.window } : action.target;
  return JSON.stringify(target);
}

function desktopActionWindow(action: DesktopAction): DesktopWindowIdentity | undefined {
  if (action.kind === 'inspect-window') return action.window;
  if (
    action.kind === 'resolve-selector' ||
    action.kind === 'read-element' ||
    action.kind === 'focus-element' ||
    action.kind === 'invoke-element' ||
    action.kind === 'set-value'
  ) {
    return action.target.window;
  }
  return undefined;
}

function isTrustedDisplayApplication(application: string): boolean {
  if (application.includes('\\') || application.includes('/')) return false;
  return TRUSTED_DISPLAY_APPLICATIONS.has(application.toLowerCase());
}

const TRUSTED_DISPLAY_APPLICATIONS = new Set([
  'notepad.exe',
  'calc.exe',
  'mspaint.exe',
  'explorer.exe',
  'snippingtool.exe',
]);

function elementAction(
  kind: 'read-element' | 'focus-element' | 'invoke-element',
  args: Record<string, unknown>,
): DesktopAction {
  return {
    kind,
    target: args.target as DesktopElementTarget,
    limits: args.limits as Partial<DesktopTreeLimits>,
  };
}

function invalidArguments(): string {
  return JSON.stringify({
    ok: false,
    code: ErrorCode.DESKTOP_PROTOCOL_MALFORMED,
    error: 'Invalid desktop tool arguments.',
  });
}

async function collectDesktopWorkerResult(events: AsyncIterable<WorkerEvent>): Promise<string> {
  let output: DesktopWorkerOutput | undefined;
  let failure: Extract<WorkerEvent, { type: 'failed' }> | undefined;
  for await (const event of events) {
    if (event.type === 'failed') failure = event;
    if (event.type === 'completed') output = event.output as DesktopWorkerOutput;
  }
  if (failure) {
    return JSON.stringify({
      ok: false,
      code: failure.error.code,
      error: failure.error.message,
      failureClass: failure.failureClass,
    });
  }
  if (!output) {
    return JSON.stringify({
      ok: false,
      code: ErrorCode.DESKTOP_CRASHED,
      error: 'Desktop worker returned no result.',
    });
  }
  return JSON.stringify(output);
}
