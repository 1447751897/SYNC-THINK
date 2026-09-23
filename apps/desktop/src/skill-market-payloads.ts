import type { InstallSkillMarketPayload } from '@sync-think/protocol';
import { isRecord } from '@sync-think/shared/value-validation';

export function parseInstallSkillMarketPayload(value: unknown): InstallSkillMarketPayload {
  const label = 'Invalid skill-market-install payload';
  if (!isRecord(value)) throw new Error(label);
  if (typeof value.marketSkillId !== 'string' || value.marketSkillId.trim().length === 0) {
    throw new Error(label);
  }
  return { marketSkillId: value.marketSkillId.trim() };
}
