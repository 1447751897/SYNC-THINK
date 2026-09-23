import { describe, expect, it, vi } from 'vitest';
import { PROMPT_DESIGN_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerPromptDesignHandlers,
  type PromptDesignHost,
} from './prompt-design-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { requestId: 'request-1' };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestPromptDesign: request as PromptDesignHost<string>['requestPromptDesign'],
  };
  registerPromptDesignHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Prompt and design IPC boundary', () => {
  it('registers the three transformation commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(Object.values(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS));
  });

  it.each([
    [
      PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.enhancePrompt,
      { requestId: ' enhance-1 ', text: ' Improve this. ', modelId: ' model-fast ' },
      'prompt.enhance',
      { requestId: 'enhance-1', text: 'Improve this.', modelId: 'model-fast' },
    ],
    [
      PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.cancelPromptEnhancement,
      { requestId: ' enhance-1 ' },
      'prompt.enhance.cancel',
      { requestId: 'enhance-1' },
    ],
    [
      PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.generateDesign,
      {
        requestId: ' design-1 ',
        frame: { id: 'frame-1', type: 'magicframe' },
        children: [{ id: 'shape-1', type: 'rectangle' }],
      },
      'design.generate',
      {
        requestId: 'design-1',
        frame: { id: 'frame-1', type: 'magicframe' },
        children: [{ id: 'shape-1', type: 'rectangle' }],
      },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.enhancePrompt)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.enhancePrompt, { requestId: '', text: 'draft' }],
    [PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.cancelPromptEnhancement, {}],
    [
      PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.generateDesign,
      { requestId: 'design-1', frame: null, children: [] },
    ],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.enhancePrompt)!(
        'trusted',
        { requestId: 'enhance-1', text: 'draft' },
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.cancelPromptEnhancement)!(
        'trusted',
        { requestId: 'enhance-1' },
      ),
    ).rejects.toBe(failure);
  });
});
