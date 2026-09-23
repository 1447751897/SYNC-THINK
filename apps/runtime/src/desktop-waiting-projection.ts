import type { DesktopWaitingCommandSummary } from '@sync-think/protocol';
import { ErrorCode, type RunId, type TaskId, type WorkspaceId } from '@sync-think/shared';

export interface DesktopWaitingCommandRecord {
  id: string;
  workspaceId: string;
  runId: string;
  ownerId: string;
  toolName: string;
  action: string;
  sanitizedArgs: Record<string, unknown>;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopWaitingTaskRef {
  id: string;
  workspaceId: string;
}

export interface DesktopWaitingRunRef {
  taskId: string;
}

export interface DesktopWaitingProjectionPorts {
  findTaskByThreadId(threadId: string): DesktopWaitingTaskRef | undefined;
  findRun(runId: string): DesktopWaitingRunRef | undefined;
  findTask(taskId: string): DesktopWaitingTaskRef | undefined;
}

export interface DesktopWaitingResult {
  commandId: string;
  code:
    | typeof ErrorCode.DESKTOP_USER_INPUT_DETECTED
    | typeof ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED;
}

export function parseDesktopWaitingResult(value: string): DesktopWaitingResult | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.commandId !== 'string' ||
      (record.code !== ErrorCode.DESKTOP_USER_INPUT_DETECTED &&
        record.code !== ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED)
    ) {
      return undefined;
    }
    return { commandId: record.commandId, code: record.code };
  } catch {
    return undefined;
  }
}

export function projectDesktopWaitingTarget(
  sanitizedArgs: Record<string, unknown>,
): DesktopWaitingCommandSummary['target'] | undefined {
  const target = sanitizedArgs.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  const window = (target as Record<string, unknown>).window;
  if (!window || typeof window !== 'object' || Array.isArray(window)) return undefined;
  const record = window as Record<string, unknown>;
  const processId =
    typeof record.processId === 'number' &&
    Number.isSafeInteger(record.processId) &&
    record.processId > 0
      ? record.processId
      : undefined;
  const title =
    typeof record.title === 'string' && record.title.trim()
      ? record.title.trim().slice(0, 512)
      : undefined;
  const appId =
    typeof record.appId === 'string' && record.appId.trim()
      ? record.appId.trim().slice(0, 256)
      : undefined;
  if (processId === undefined && title === undefined && appId === undefined) return undefined;
  return {
    ...(processId !== undefined ? { processId } : {}),
    ...(title ? { title } : {}),
    ...(appId ? { appId } : {}),
  };
}

export function projectDesktopWaitingCommandSummary(
  command: DesktopWaitingCommandRecord,
  ports: DesktopWaitingProjectionPorts,
): DesktopWaitingCommandSummary {
  const ownerTask = ports.findTaskByThreadId(command.ownerId);
  const run = ownerTask ? undefined : ports.findRun(command.runId);
  const runTask = run ? ports.findTask(run.taskId) : undefined;
  const taskId =
    ownerTask?.workspaceId === command.workspaceId
      ? ownerTask.id
      : runTask?.workspaceId === command.workspaceId
        ? run?.taskId
        : undefined;
  const target = projectDesktopWaitingTarget(command.sanitizedArgs);
  const errorCode = command.errorCode ?? ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED;
  return {
    commandId: command.id,
    workspaceId: command.workspaceId as WorkspaceId,
    ...(taskId ? { taskId: taskId as TaskId } : {}),
    runId: command.runId as RunId,
    toolName: command.toolName,
    action: command.action,
    ...(target ? { target } : {}),
    reason:
      errorCode === ErrorCode.DESKTOP_USER_INPUT_DETECTED
        ? 'user-input-detected'
        : errorCode === ErrorCode.DESKTOP_COMMAND_INSPECTION_REQUIRED
          ? 'restart-inspection'
          : 'attention-required',
    errorCode,
    status: 'waiting_user',
    canContinue: true,
    canCancel: true,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
  };
}
