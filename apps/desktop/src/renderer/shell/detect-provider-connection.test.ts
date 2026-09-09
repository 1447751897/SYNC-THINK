import { describe, expect, it } from 'vitest';
import {
  addDefaultScheme,
  detectProviderConnectionInput,
  isLocalUrl,
  sanitizeConfigInput,
} from './detect-provider-connection.js';

describe('detectProviderConnectionInput', () => {
  it('strips chat completions and marks OpenAI chat', () => {
    expect(
      detectProviderConnectionInput('https://www.kamenking.top/v1/chat/completions'),
    ).toEqual({
      baseUrl: 'https://www.kamenking.top/v1',
      apiFormat: 'openai',
      forceResponsesApi: false,
      normalized: true,
    });
  });

  it('strips responses and forces Responses API', () => {
    expect(detectProviderConnectionInput('https://api.openai.com/v1/responses')).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiFormat: 'openai',
      forceResponsesApi: true,
      normalized: true,
    });
  });

  it('strips messages and marks Anthropic', () => {
    expect(detectProviderConnectionInput('https://api.anthropic.com/v1/messages')).toEqual({
      baseUrl: 'https://api.anthropic.com/v1',
      apiFormat: 'anthropic',
      forceResponsesApi: false,
      normalized: true,
    });
  });

  it('detects OpenAI from a known host when the path has no suffix', () => {
    expect(detectProviderConnectionInput('https://api.deepseek.com/v1')).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      apiFormat: 'openai',
      forceResponsesApi: null,
    });
  });

  it('adds https for a bare hostname', () => {
    expect(addDefaultScheme('api.example.com/v1')).toBe('https://api.example.com/v1');
    expect(detectProviderConnectionInput('api.example.com/v1').baseUrl).toBe(
      'https://api.example.com/v1',
    );
  });

  it('removes invisible characters and spaces', () => {
    expect(sanitizeConfigInput(' https://api.openai.com/v1 ')).toBe('https://api.openai.com/v1');
  });

  it('matches NewMax local URL hosts', () => {
    expect(isLocalUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLocalUrl('https://api.openai.com/v1')).toBe(false);
  });
});
