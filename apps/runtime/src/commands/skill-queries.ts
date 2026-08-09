import type { Socket } from 'node:net';
import {
  encodeFrame,
  type Frame,
  type GetSkillResponse,
  type ListMcpServersResponse,
  type ListSkillsResponse,
} from '@sync-think/protocol';
import { ErrorCode } from '@sync-think/shared';
import {
  parseGetSkillPayload,
  parseListMcpServersPayload,
  parseListSkillsPayload,
} from '../command-validation.js';
import type { SkillQueryContext } from './skill-query-context.js';

/** Read one Skill version's full SKILL.md source for display (never executed). */
export function handleGetSkill(ctx: SkillQueryContext, socket: Socket, frame: Frame): void {
  const payload = parseGetSkillPayload(frame.payload);
  if (!payload) {
    ctx.writeMalformedPayload(socket, frame);
    return;
  }
  if (!ctx.skillStore) {
    ctx.writeSkillStoreUnavailable(socket, frame);
    return;
  }
  try {
    const record = ctx.skillStore.getVersion(payload.skillVersionId);
    if (!record) {
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'skill.get',
          payload: {},
          error: {
            code: ErrorCode.STORAGE_WRITE_FAILED,
            message: 'Skill version not found',
            detail: { reason: 'not_found', skillVersionId: payload.skillVersionId },
          },
        }),
      );
      return;
    }
    const response: GetSkillResponse = {
      skill: ctx.toSkillVersionSummary(record),
      sourceMd: record.sourceMd,
      body: record.body,
    };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'skill.get',
        payload: response,
      }),
    );
  } catch (error) {
    ctx.writeProviderCommandError(socket, frame, error);
  }
}

export function handleListSkills(ctx: SkillQueryContext, socket: Socket, frame: Frame): void {
  const payload = parseListSkillsPayload(frame.payload ?? {});
  if (!payload) {
    ctx.writeMalformedPayload(socket, frame);
    return;
  }
  if (!ctx.skillStore) {
    ctx.writeSkillStoreUnavailable(socket, frame);
    return;
  }
  try {
    const records = payload.skillVersionIds
      ? ctx.skillStore.listVersionMetadataByIds(payload.skillVersionIds)
      : payload.workspaceId && ctx.capabilityStore
        ? ctx.skillStore.listVersionMetadataByIds(
            ctx.capabilityStore.listActiveCapabilityIds(
              payload.workspaceId,
              'skill',
              payload.limit ?? 100,
            ),
          )
        : ctx.skillStore.listVersionMetadata(payload.limit ?? 100);
    const skills = records
      .map((r) => ctx.toSkillVersionSummary(r));
    const response: ListSkillsResponse = { skills };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'skill.list',
        payload: response,
      }),
    );
  } catch (error) {
    ctx.writeProviderCommandError(socket, frame, error);
  }
}

export function handleListMcpServers(ctx: SkillQueryContext, socket: Socket, frame: Frame): void {
  const payload = parseListMcpServersPayload(frame.payload ?? {});
  if (!payload) {
    ctx.writeMalformedPayload(socket, frame);
    return;
  }
  if (!ctx.mcpStore) {
    ctx.writeMcpStoreUnavailable(socket, frame);
    return;
  }
  try {
    const servers = ctx.mcpStore
      .list(payload.limit ?? 100)
      .map((r) => ctx.toMcpServerSummary(r));
    const response: ListMcpServersResponse = { servers };
    socket.write(
      encodeFrame({
        id: frame.id,
        kind: 'response',
        type: 'mcp.list',
        payload: response,
      }),
    );
  } catch (error) {
    ctx.writeProviderCommandError(socket, frame, error);
  }
}
