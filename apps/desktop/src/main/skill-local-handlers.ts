import type {
  SkillLocalCommand,
  SkillLocalCommandRequest,
  SkillLocalCommandResponse,
} from '@sync-think/protocol';
import {
  parseSkillLocalImportPayload,
  parseSkillLocalInspectPayload,
  parseSkillLocalScanPayload,
} from '../skill-local-payloads.js';

export interface SkillLocalHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestSkillLocal<K extends SkillLocalCommand>(
    command: K,
    payload: SkillLocalCommandRequest<NoInfer<K>>,
  ): Promise<SkillLocalCommandResponse<K>>;
}

export function registerSkillLocalHandlers<Event>(host: SkillLocalHost<Event>): void {
  host.handle('runtime:skill-local-scan', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkillLocal('skill.local.scan', parseSkillLocalScanPayload(value));
  });

  host.handle('runtime:skill-local-inspect', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkillLocal('skill.local.inspect', parseSkillLocalInspectPayload(value));
  });

  host.handle('runtime:skill-local-import', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkillLocal('skill.local.import', parseSkillLocalImportPayload(value));
  });
}
