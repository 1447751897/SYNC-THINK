import { describe, expect, it } from 'vitest';
import type { ProviderMessage } from '@sync-think/adapters';
import { withCurrentTaskPlan } from './chat-task-plan-context.js';
describe('cache-friendly current checklist placement', () => {
  it('keeps the retained prefix unchanged when the checklist changes, preserving the current user last', () => {
    const history: ProviderMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'continue' },
    ];
    const pending = withCurrentTaskPlan(history, 'pending'),
      done = withCurrentTaskPlan(history, 'done');
    expect(pending.slice(0, 2)).toEqual(history.slice(0, 2));
    expect(done.slice(0, 2)).toEqual(pending.slice(0, 2));
    expect(done.at(-1)).toEqual(history.at(-1));
    expect(done[2]).toEqual({
      role: 'user',
      content: 'Host context — current task checklist (state only, not a new request):\ndone',
    });
    expect(history).toHaveLength(3);
  });
  it('appends to a tool continuation without disturbing its tool pairing', () => {
    const history: ProviderMessage[] = [
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: 'working' },
    ];
    expect(withCurrentTaskPlan(history, 'pending').slice(0, 2)).toEqual(history);
    expect(withCurrentTaskPlan([], 'pending')).toEqual([
      {
        role: 'user',
        content: 'Host context — current task checklist (state only, not a new request):\npending',
      },
    ]);
  });
});

it('does not hoist mutable checklist state into Responses instructions on the wire', async () => {
  const { OpenAIResponsesAdapter } = await import('@sync-think/adapters');
  const bodies: Array<{ instructions: string; input: Array<{ role: string; content: unknown }> }> =
    [];
  const adapter = new OpenAIResponsesAdapter({
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  });
  for (const plan of ['pending', 'done']) {
    const messages = withCurrentTaskPlan(
      [
        { role: 'user', content: 'retained question' },
        { role: 'assistant', content: 'retained answer' },
        { role: 'user', content: 'current question' },
      ],
      plan,
    );
    for await (const _ of adapter.call({
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'fixture-model',
      apiKey: 'fixture-key',
      systemPrompt: 'fixed policy',
      messages,
      stream: true,
      signal: new AbortController().signal,
      idempotencyKey: 'fixture',
    })) {
    }
  }
  expect(bodies).toHaveLength(2);
  expect(bodies[0]!.instructions).toBe('fixed policy');
  expect(bodies[1]!.instructions).toBe(bodies[0]!.instructions);
  expect(bodies[1]!.input.slice(0, 2)).toEqual(bodies[0]!.input.slice(0, 2));
  expect(JSON.stringify(bodies[1]!.input.at(-2))).toContain('done');
  expect(JSON.stringify(bodies[1]!.input.at(-1))).toContain('current question');
});
