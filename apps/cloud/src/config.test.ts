import { describe, expect, it } from 'vitest';
import { readCloudConfig } from './config.js';

const secret = '297dc7b472e66fe364a42bcd5a2c870b657af216d3e3e41e8c7b40d4168e7b3c';

describe('cloud startup configuration', () => {
  it('validates explicit iframe parent origins and permits loopback HTTP only in development', () => {
    expect(readCloudConfig({}).embedOrigins).toEqual([]);
    expect(
      readCloudConfig({
        CLOUD_EMBED_ORIGINS:
          ' https://portal.example.test/, https://docs.example.test:8443,https://portal.example.test ',
      }).embedOrigins,
    ).toEqual(['https://portal.example.test', 'https://docs.example.test:8443']);
    expect(
      readCloudConfig({ CLOUD_EMBED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:5173' })
        .embedOrigins,
    ).toEqual(['http://localhost:3000', 'http://127.0.0.1:5173']);
    for (const invalid of [
      '*',
      'https://*.example.test',
      'data:text/html,hello',
      'javascript:alert(1)',
      'https://portal.example.test/path',
      'https://user:password@portal.example.test',
      'https://portal.example.test?next=1',
      'https://portal.example.test#part',
      'http://portal.example.test',
      "https://portal.example.test'; frame-ancestors *",
      'https://portal.example.test,,https://docs.example.test',
    ]) {
      expect(() => readCloudConfig({ CLOUD_EMBED_ORIGINS: invalid })).toThrow(
        'CLOUD_EMBED_ORIGINS',
      );
    }
    expect(() =>
      readCloudConfig({
        NODE_ENV: 'production',
        CLOUD_ORIGIN: 'https://accounts.example.test',
        CLOUD_AUTH_SECRET: secret,
        CLOUD_EMBED_ORIGINS: 'http://localhost:3000',
      }),
    ).toThrow('CLOUD_EMBED_ORIGINS');
  });

  it('requires HTTPS and a persistent strong secret in production', () => {
    expect(() =>
      readCloudConfig({ NODE_ENV: 'production', CLOUD_ORIGIN: 'https://accounts.example.test' }),
    ).toThrow('CLOUD_AUTH_SECRET is required');
    expect(() => readCloudConfig({ NODE_ENV: 'production', CLOUD_AUTH_SECRET: secret })).toThrow(
      'CLOUD_ORIGIN must use HTTPS',
    );
    expect(() => readCloudConfig({ CLOUD_AUTH_SECRET: 'short' })).toThrow(
      'CLOUD_AUTH_SECRET must contain at least 32 bytes',
    );
    const config = readCloudConfig({
      NODE_ENV: 'production',
      CLOUD_ORIGIN: 'https://accounts.example.test',
      CLOUD_AUTH_SECRET: secret,
    });
    expect(config.origin).toBe('https://accounts.example.test');
    expect(config.host).toBe('127.0.0.1');
    expect(config.allowSignup).toBe(false);
    expect(config.trustProxy).toBe(false);
  });

  it('rejects malformed origins, partial SMTP credentials and mistyped registration flags', () => {
    expect(() => readCloudConfig({ CLOUD_ORIGIN: 'https://user:password@example.test' })).toThrow(
      'without credentials',
    );
    expect(() => readCloudConfig({ CLOUD_ORIGIN: 'https://example.test/login' })).toThrow(
      'without credentials',
    );
    expect(() => readCloudConfig({ CLOUD_ORIGIN: 'http://example.test' })).toThrow(
      'must use HTTPS',
    );
    expect(() => readCloudConfig({ CLOUD_SMTP_HOST: 'smtp.example.test' })).toThrow(
      'CLOUD_SMTP_FROM',
    );
    expect(() =>
      readCloudConfig({
        CLOUD_SMTP_HOST: 'smtp.example.test',
        CLOUD_SMTP_FROM: 'accounts@example.test',
        CLOUD_SMTP_USER: 'smtp-user',
      }),
    ).toThrow('configured together');
    expect(() => readCloudConfig({ CLOUD_ALLOW_SIGNUP: 'yes' })).toThrow('must be true or false');
  });
});
