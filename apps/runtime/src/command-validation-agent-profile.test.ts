import { describe, expect, it } from 'vitest';
import { parseCreateAgentPayload } from './command-validation.js';

const base = {
  name: 'Architect',
  role: 'Architecture and system design',
  developerInstructions: 'Design before implementation.',
  inputContract: 'Task context and constraints.',
  outputContract: 'Architecture decision and verification.',
  defaultModelId: 'model-1',
};

describe('Agent profile command validation', () => {
  it('accepts a bounded maximum task concurrency', () => {
    expect(parseCreateAgentPayload({ ...base, maxConcurrency: 4 })).toMatchObject({
      maxConcurrency: 4,
    });
    expect(parseCreateAgentPayload({ ...base, maxConcurrency: 0 })).toBeUndefined();
    expect(parseCreateAgentPayload({ ...base, maxConcurrency: 17 })).toBeUndefined();
    expect(parseCreateAgentPayload({ ...base, maxConcurrency: 1.5 })).toBeUndefined();
  });

  it('accepts only a managed avatar path without accepting unrelated fields', () => {
    expect(
      parseCreateAgentPayload({
        ...base,
        visualIdentity: {
          icon: 'bot',
          color: '#0d9488',
          avatarPath: `avatars/${'a'.repeat(64)}.png`,
        },
      }),
    ).toBeDefined();
    expect(
      parseCreateAgentPayload({
        ...base,
        visualIdentity: {
          icon: 'bot',
          color: '#0d9488',
          avatarPath: 'C:\\Users\\demo\\secret.png',
        },
      }),
    ).toBeUndefined();
    expect(
      parseCreateAgentPayload({
        ...base,
        visualIdentity: { icon: 'bot', color: '#0d9488', sourceUrl: 'https://example.test' },
      }),
    ).toBeUndefined();
  });
});
