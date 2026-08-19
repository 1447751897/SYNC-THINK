/**
 * 守护进程 ↔ 桌面 runtime 的投递协议帧（spec 投递协议章节 + T4）。
 *
 * 三帧契约（与 spec 内联定义完全一致）：
 *   task.dispatch      守护进程 → 桌面：{ taskId, instruction, target, skillVersionIds, workspaceId? }
 *   task.dispatch.ack  桌面 → 守护进程（立即回复，不等执行完成）：{ taskId, accepted }
 *   task.abort         桌面退出前 → 守护进程（用户主动关闭）：{ taskId, reason }
 *
 * 复用 protocol 包的 Frame / encodeFrame；本模块提供帧构造 + 字段白名单
 * 校验 + 非法帧拒绝。白名单语义：必填字段缺失 / 类型错误 → 拒绝；
 * 未知额外字段忽略（向前兼容——协议演进不破坏老客户端）。
 */

import type { Frame } from '@sync-think/protocol';
import type { ScheduledTaskTarget } from '@sync-think/shared';

// ── 帧类型 ─────────────────────────────────────────────────────────────────

export interface DispatchPayload {
  taskId: string;
  instruction: string;
  target: ScheduledTaskTarget;
  skillVersionIds: string[];
  workspaceId?: string;
}

export interface DispatchAckPayload {
  taskId: string;
  accepted: boolean;
}

export interface AbortPayload {
  taskId: string;
  reason: string;
}

export type TaskFrame =
  | { type: 'task.dispatch'; payload: DispatchPayload }
  | { type: 'task.dispatch.ack'; payload: DispatchAckPayload }
  | { type: 'task.abort'; payload: AbortPayload };

export type ParseTaskFrameResult =
  | { ok: true; frame: TaskFrame }
  | { ok: false; error: string };

// ── 帧构造 ─────────────────────────────────────────────────────────────────

export function encodeDispatchFrame(payload: DispatchPayload): Frame<DispatchPayload> {
  return { id: `dispatch:${payload.taskId}`, kind: 'request', type: 'task.dispatch', payload };
}

export function encodeDispatchAck(taskId: string, accepted: boolean): Frame<DispatchAckPayload> {
  return { id: `ack:${taskId}`, kind: 'response', type: 'task.dispatch.ack', payload: { taskId, accepted } };
}

export function encodeAbort(taskId: string, reason: string): Frame<AbortPayload> {
  return { id: `abort:${taskId}`, kind: 'request', type: 'task.abort', payload: { taskId, reason } };
}

// ── 白名单校验 ─────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTarget(value: unknown): value is ScheduledTaskTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  if (target.kind === 'agent') return isNonEmptyString(target.agentId);
  if (target.kind === 'model') return isNonEmptyString(target.modelId);
  if (target.kind === 'team') return isNonEmptyString(target.teamId);
  return false;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseDispatchPayload(payload: unknown): DispatchPayload | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const raw = payload as Record<string, unknown>;
  if (!isNonEmptyString(raw.taskId)) return undefined;
  if (!isNonEmptyString(raw.instruction)) return undefined;
  if (!isTarget(raw.target)) return undefined;
  if (!isStringArray(raw.skillVersionIds)) return undefined;
  if (raw.workspaceId !== undefined && !isNonEmptyString(raw.workspaceId)) return undefined;
  return {
    taskId: raw.taskId,
    instruction: raw.instruction,
    target: raw.target,
    skillVersionIds: raw.skillVersionIds,
    ...(raw.workspaceId !== undefined ? { workspaceId: raw.workspaceId } : {}),
  };
}

function parseAckPayload(payload: unknown): DispatchAckPayload | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const raw = payload as Record<string, unknown>;
  if (!isNonEmptyString(raw.taskId)) return undefined;
  if (typeof raw.accepted !== 'boolean') return undefined;
  return { taskId: raw.taskId, accepted: raw.accepted };
}

function parseAbortPayload(payload: unknown): AbortPayload | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const raw = payload as Record<string, unknown>;
  if (!isNonEmptyString(raw.taskId)) return undefined;
  if (!isNonEmptyString(raw.reason)) return undefined;
  return { taskId: raw.taskId, reason: raw.reason };
}

// ── 解析入口 ───────────────────────────────────────────────────────────────

export function parseTaskFrame(frame: Frame): ParseTaskFrameResult {
  switch (frame.type) {
    case 'task.dispatch': {
      const payload = parseDispatchPayload(frame.payload);
      if (!payload) return { ok: false, error: 'task.dispatch: 字段校验失败' };
      return { ok: true, frame: { type: 'task.dispatch', payload } };
    }
    case 'task.dispatch.ack': {
      const payload = parseAckPayload(frame.payload);
      if (!payload) return { ok: false, error: 'task.dispatch.ack: 字段校验失败' };
      return { ok: true, frame: { type: 'task.dispatch.ack', payload } };
    }
    case 'task.abort': {
      const payload = parseAbortPayload(frame.payload);
      if (!payload) return { ok: false, error: 'task.abort: 字段校验失败' };
      return { ok: true, frame: { type: 'task.abort', payload } };
    }
    default:
      return { ok: false, error: `未知帧类型: ${frame.type}` };
  }
}
