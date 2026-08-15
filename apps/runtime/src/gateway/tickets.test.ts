import { describe, it, expect } from 'vitest';
import {
  GatewayTicketRegistry,
  kernelNeedsGateway,
  toGatewayUpstreamProtocol,
} from './tickets.js';

const route = {
  baseUrl: 'https://relay.example.com/v1',
  protocol: 'openai-chat' as const,
  providerModelId: 'gpt-5.6-sol',
  apiKey: 'sk-upstream',
  providerId: 'prov-a',
};

describe('GatewayTicketRegistry', () => {
  it('issues an opaque ticket that resolves back to the exact route', () => {
    const registry = new GatewayTicketRegistry();
    const ticket = registry.issue('run-1', route);
    expect(ticket.id).toMatch(/^stgw_/);
    // The ticket id must not leak the upstream secret.
    expect(ticket.id).not.toContain('sk-upstream');
    expect(registry.resolve(ticket.id)).toEqual(route);
    expect(registry.resolveWithRun(ticket.id)).toEqual({ runId: 'run-1', route });
  });

  it('resolves nothing for unknown or missing keys', () => {
    const registry = new GatewayTicketRegistry();
    expect(registry.resolve(undefined)).toBeUndefined();
    expect(registry.resolve('stgw_bogus')).toBeUndefined();
  });

  it('revokes the previous ticket when a run is re-issued', () => {
    const registry = new GatewayTicketRegistry();
    const first = registry.issue('run-1', route);
    const second = registry.issue('run-1', { ...route, providerModelId: 'gpt-5.6-luna' });
    expect(registry.resolve(first.id)).toBeUndefined();
    expect(registry.resolve(second.id)?.providerModelId).toBe('gpt-5.6-luna');
    expect(registry.size).toBe(1);
  });

  it('keeps tickets from different runs isolated', () => {
    const registry = new GatewayTicketRegistry();
    const a = registry.issue('run-a', route);
    const b = registry.issue('run-b', { ...route, providerId: 'prov-b', apiKey: 'sk-b' });
    registry.recordResponseForFunctionCall(a.id, 'call-1', 'resp-a');
    registry.recordResponseForFunctionCall(b.id, 'call-1', 'resp-b');
    expect(registry.resolveResponseForFunctionCall(a.id, 'call-1')).toBe('resp-a');
    expect(registry.resolveResponseForFunctionCall(b.id, 'call-1')).toBe('resp-b');
    registry.revokeRun('run-a');
    expect(registry.resolve(a.id)).toBeUndefined();
    expect(registry.resolveResponseForFunctionCall(a.id, 'call-1')).toBeUndefined();
    expect(registry.resolve(b.id)?.providerId).toBe('prov-b');
    expect(registry.resolveResponseForFunctionCall(b.id, 'call-1')).toBe('resp-b');
  });

  it('revoking an unknown run is a no-op and clear() drops everything', () => {
    const registry = new GatewayTicketRegistry();
    registry.revokeRun('never-existed');
    const ticket = registry.issue('run-1', route);
    registry.recordResponseForFunctionCall(ticket.id, 'call-1', 'resp-1');
    registry.recordRunUsage('run-1', {
      requestId: 'request-1',
      providerId: 'prov-a',
      providerModelId: 'gpt-5.6-sol',
      tokensIn: 8,
      tokensOut: 2,
      totalTokens: 10,
    });
    registry.clear();
    expect(registry.resolve(ticket.id)).toBeUndefined();
    expect(registry.resolveResponseForFunctionCall(ticket.id, 'call-1')).toBeUndefined();
    expect(registry.consumeRunUsage('run-1')).toEqual([]);
    expect(registry.size).toBe(0);
  });

  it('aggregates progressive provider usage per run and request until consumed', () => {
    const registry = new GatewayTicketRegistry();
    registry.recordRunUsage('run-usage', {
      requestId: 'request-1',
      providerId: 'prov-a',
      providerModelId: 'gpt-5.6-sol',
      tokensIn: 12,
      tokensOut: 0,
      cachedTokensHit: 4,
      totalTokens: 12,
    });
    registry.recordRunUsage('run-usage', {
      requestId: 'request-1',
      providerResponseId: 'response-1',
      providerId: 'prov-a',
      providerModelId: 'gpt-5.6-sol',
      tokensIn: 12,
      tokensOut: 5,
      cachedTokensHit: 4,
      cachedTokensCreated: 2,
      reasoningTokens: 3,
      totalTokens: 17,
    });
    registry.recordRunUsage('run-usage', {
      requestId: 'request-2',
      providerId: 'prov-a',
      providerModelId: 'gpt-5.6-sol',
      tokensIn: 7,
      tokensOut: 2,
      totalTokens: 9,
    });

    expect(registry.consumeRunUsage('run-usage')).toEqual([
      {
        requestId: 'request-1',
        providerResponseId: 'response-1',
        providerId: 'prov-a',
        providerModelId: 'gpt-5.6-sol',
        tokensIn: 12,
        tokensOut: 5,
        cachedTokensHit: 4,
        cachedTokensCreated: 2,
        reasoningTokens: 3,
        totalTokens: 17,
      },
      {
        requestId: 'request-2',
        providerId: 'prov-a',
        providerModelId: 'gpt-5.6-sol',
        tokensIn: 7,
        tokensOut: 2,
        totalTokens: 9,
      },
    ]);
    expect(registry.consumeRunUsage('run-usage')).toEqual([]);
  });

  it('drops unconsumed provider usage when its run is revoked', () => {
    const registry = new GatewayTicketRegistry();
    registry.issue('run-usage', route);
    registry.recordRunUsage('run-usage', {
      requestId: 'request-1',
      providerId: 'prov-a',
      providerModelId: 'gpt-5.6-sol',
      tokensIn: 8,
      tokensOut: 2,
      totalTokens: 10,
    });

    registry.revokeRun('run-usage');

    expect(registry.consumeRunUsage('run-usage')).toEqual([]);
  });

  it('clears response continuation items when a run ticket is re-issued', () => {
    const registry = new GatewayTicketRegistry();
    const first = registry.issue('run-1', route);
    registry.recordResponseForFunctionCall(first.id, 'call-1', 'resp-1');

    const second = registry.issue('run-1', route);

    expect(registry.resolveResponseForFunctionCall(first.id, 'call-1')).toBeUndefined();
    expect(registry.resolveResponseForFunctionCall(second.id, 'call-1')).toBeUndefined();
  });

  it('keeps a stable session continuation scope when one run ticket is revoked', () => {
    const registry = new GatewayTicketRegistry();
    const scopeId = 'kernel_session_scope';
    const first = registry.issue('run-1', {
      ...route,
      responseContinuationScopeId: scopeId,
    });
    registry.recordResponseForFunctionCall(scopeId, 'call-1', 'resp-1');

    registry.revokeRun('run-1');
    const second = registry.issue('run-2', {
      ...route,
      responseContinuationScopeId: scopeId,
    });

    expect(registry.resolve(first.id)).toBeUndefined();
    expect(registry.resolve(second.id)).toEqual({
      ...route,
      responseContinuationScopeId: scopeId,
    });
    expect(registry.resolveResponseForFunctionCall(scopeId, 'call-1')).toBe('resp-1');
  });

  it('restores persisted continuation items after the process-local cache is cleared', () => {
    const persisted = new Map<string, readonly (readonly [string, string])[]>();
    const persistence = {
      load: (scopeId: string) => persisted.get(scopeId),
      save: (
        scopeId: string,
        items: readonly (readonly [string, string])[],
      ) => persisted.set(scopeId, items.map(([callId, itemId]) => [callId, itemId])),
      remove: (scopeId: string) => {
        persisted.delete(scopeId);
      },
    };
    const scopeId = 'kernel_persisted_scope';
    const firstRegistry = new GatewayTicketRegistry(persistence);
    firstRegistry.recordResponseForFunctionCall(scopeId, 'call-1', 'resp-1');
    firstRegistry.clear();

    const restoredRegistry = new GatewayTicketRegistry(persistence);
    expect(restoredRegistry.resolveResponseForFunctionCall(scopeId, 'call-1')).toBe(
      'resp-1',
    );

    restoredRegistry.clearResponseFunctionItems(scopeId);
    const afterRemoval = new GatewayTicketRegistry(persistence);
    expect(afterRemoval.resolveResponseForFunctionCall(scopeId, 'call-1')).toBeUndefined();
  });
});

describe('toGatewayUpstreamProtocol', () => {
  it('folds openai-responses onto openai-chat and rejects unrelated families', () => {
    expect(toGatewayUpstreamProtocol('anthropic-messages')).toBe('anthropic-messages');
    expect(toGatewayUpstreamProtocol('openai-chat')).toBe('openai-chat');
    expect(toGatewayUpstreamProtocol('openai-responses')).toBe('openai-responses');
    expect(toGatewayUpstreamProtocol('openai-images')).toBeUndefined();
    expect(toGatewayUpstreamProtocol(undefined)).toBeUndefined();
  });
});

describe('kernelNeedsGateway', () => {
  it('routes Claude Code through the gateway only for OpenAI upstreams', () => {
    const claudeCode = ['anthropic-messages'];
    expect(kernelNeedsGateway(claudeCode, 'openai-chat')).toBe(true);
    expect(kernelNeedsGateway(claudeCode, 'anthropic-messages')).toBe(false);
  });

  it('routes Codex through the gateway only for Anthropic upstreams', () => {
    const codex = ['openai-chat', 'openai-responses'];
    expect(kernelNeedsGateway(codex, 'anthropic-messages')).toBe(true);
    expect(kernelNeedsGateway(codex, 'openai-chat')).toBe(false);
  });

  it('never routes a kernel that already speaks both dialects', () => {
    const pi = ['openai-chat', 'anthropic-messages'];
    expect(kernelNeedsGateway(pi, 'openai-chat')).toBe(false);
    expect(kernelNeedsGateway(pi, 'anthropic-messages')).toBe(false);
  });

  it('treats an empty protocol list as "no gateway" rather than forcing one', () => {
    expect(kernelNeedsGateway([], 'openai-chat')).toBe(false);
  });
});
