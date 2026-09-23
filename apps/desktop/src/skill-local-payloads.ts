import type {
  SkillLocalImportPayload,
  SkillLocalInspectPayload,
  SkillLocalScanPayload,
} from '@sync-think/protocol';
import { isRecord } from '@sync-think/shared/value-validation';

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(label);
  return value.trim();
}

export function parseSkillLocalScanPayload(value: unknown): SkillLocalScanPayload {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.refresh === 'boolean' ? { refresh: value.refresh } : {}),
  };
}

export function parseSkillLocalInspectPayload(value: unknown): SkillLocalInspectPayload {
  const label = 'Invalid skill-local-inspect payload';
  if (!isRecord(value)) throw new Error(label);
  return { path: requiredString(value.path, label) };
}

export function parseSkillLocalImportPayload(value: unknown): SkillLocalImportPayload {
  const label = 'Invalid skill-local-import payload';
  if (!isRecord(value)) throw new Error(label);
  let scope: SkillLocalImportPayload['scope'];
  if (isRecord(value.scope)) {
    if (value.scope.type === 'global') {
      scope = { type: 'global' };
    } else if (value.scope.type === 'workspace') {
      scope = {
        type: 'workspace',
        workspaceId: requiredString(value.scope.workspaceId, label),
      };
    } else {
      throw new Error(label);
    }
  }
  return {
    path: requiredString(value.path, label),
    ...(scope ? { scope } : {}),
    ...(typeof value.overwrite === 'boolean' ? { overwrite: value.overwrite } : {}),
  };
}
