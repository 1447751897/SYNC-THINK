import type { SkillCommand, SkillCommandRequest, SkillCommandResponse } from '@sync-think/protocol';
import {
  parseDeleteSkillPayload,
  parseGetSkillPayload,
  parseImportRemoteSkillPayload,
  parseImportSkillPayload,
  parseListSkillsPayload,
  parseSetSkillEnabledPayload,
} from '../skill-payloads.js';

export interface SkillHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestSkill<K extends SkillCommand>(
    command: K,
    payload: SkillCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<SkillCommandResponse<K>>;
}

export function registerSkillHandlers<Event>(host: SkillHost<Event>): void {
  host.handle('runtime:skill-import', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkill('skill.import', parseImportSkillPayload(value));
  });

  host.handle('runtime:skill-import-remote', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkill('skill.importRemote', parseImportRemoteSkillPayload(value), {
      timeoutMs: 30_000,
    });
  });

  host.handle('runtime:skill-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkill('skill.list', parseListSkillsPayload(value));
  });

  host.handle('runtime:skill-delete', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkill('skill.delete', parseDeleteSkillPayload(value));
  });

  host.handle('runtime:skill-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkill('skill.get', parseGetSkillPayload(value));
  });

  host.handle('runtime:skill-set-enabled', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkill('skill.setEnabled', parseSetSkillEnabledPayload(value));
  });
}
