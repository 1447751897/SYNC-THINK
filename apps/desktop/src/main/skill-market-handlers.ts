import type {
  SkillMarketCommand,
  SkillMarketCommandRequest,
  SkillMarketCommandResponse,
} from '@sync-think/protocol';
import { parseInstallSkillMarketPayload } from '../skill-market-payloads.js';

export interface SkillMarketHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestSkillMarket<K extends SkillMarketCommand>(
    command: K,
    payload: SkillMarketCommandRequest<NoInfer<K>>,
  ): Promise<SkillMarketCommandResponse<K>>;
}

export function registerSkillMarketHandlers<Event>(host: SkillMarketHost<Event>): void {
  host.handle('runtime:skill-market-list', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkillMarket('skill.market.list', {});
  });

  host.handle('runtime:skill-market-install', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestSkillMarket('skill.market.install', parseInstallSkillMarketPayload(value));
  });
}
