import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export interface CloudConfig {
  host: string;
  port: number;
  origin: string;
  secret?: string;
  databasePath: string;
  websiteDirectory: string;
  allowSignup: boolean;
  trustProxy: boolean;
  embedOrigins: string[];
  smtp?: SmtpConfig;
}

function integer(value: string | undefined, fallback: number, name: string, minimum = 1): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  const result = Number(value);
  if (result < minimum || result > 65535) throw new Error(`${name} is outside its valid range`);
  return result;
}

function flag(value: string | undefined, name: string): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false`);
}

function readEmbedOrigins(value: string | undefined, production: boolean): string[] {
  if (!value?.trim()) return [];
  const invalid = () =>
    new Error(
      'CLOUD_EMBED_ORIGINS must contain only explicit HTTPS origins without credentials, paths, queries, fragments, or wildcards; development may use loopback HTTP',
    );
  const origins = value.split(',').map((entry) => {
    const input = entry.trim();
    if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(input)) throw invalid();
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw invalid();
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !/^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\])$/i.test(url.hostname)
    )
      throw invalid();
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !production))
      throw invalid();
    return url.origin;
  });
  return [...new Set(origins)];
}

export function readCloudConfig(
  env: NodeJS.ProcessEnv = process.env,
  workspaceDirectory = fileURLToPath(new URL('../../../', import.meta.url)),
): CloudConfig {
  const port = integer(env.CLOUD_PORT, 4175, 'CLOUD_PORT', 0);
  const origin = new URL(env.CLOUD_ORIGIN ?? `http://127.0.0.1:${port || 4175}`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error('CLOUD_ORIGIN must be an origin without credentials, path, query, or fragment');
  }
  if (
    origin.protocol !== 'https:' &&
    !(origin.protocol === 'http:' && loopback && env.NODE_ENV !== 'production')
  ) {
    throw new Error('CLOUD_ORIGIN must use HTTPS; local development may use loopback HTTP');
  }
  const secret = env.CLOUD_AUTH_SECRET?.trim() || undefined;
  if (
    secret &&
    (Buffer.byteLength(secret) < 32 || /^(change|replace|example|your[-_])/i.test(secret))
  ) {
    throw new Error(
      'CLOUD_AUTH_SECRET must contain at least 32 bytes of randomly generated secret',
    );
  }
  if (env.NODE_ENV === 'production' && !secret) {
    throw new Error('CLOUD_AUTH_SECRET is required in production');
  }
  const smtpKeys = ['CLOUD_SMTP_HOST', 'CLOUD_SMTP_FROM', 'CLOUD_SMTP_USER', 'CLOUD_SMTP_PASSWORD'];
  let smtp: SmtpConfig | undefined;
  if (smtpKeys.some((key) => Boolean(env[key]))) {
    if (!env.CLOUD_SMTP_HOST?.trim() || !env.CLOUD_SMTP_FROM?.trim()) {
      throw new Error('SMTP requires CLOUD_SMTP_HOST and CLOUD_SMTP_FROM');
    }
    if (Boolean(env.CLOUD_SMTP_USER) !== Boolean(env.CLOUD_SMTP_PASSWORD)) {
      throw new Error('CLOUD_SMTP_USER and CLOUD_SMTP_PASSWORD must be configured together');
    }
    const secure = flag(env.CLOUD_SMTP_SECURE, 'CLOUD_SMTP_SECURE');
    smtp = {
      host: env.CLOUD_SMTP_HOST.trim(),
      port: integer(env.CLOUD_SMTP_PORT, secure ? 465 : 587, 'CLOUD_SMTP_PORT'),
      secure,
      ...(env.CLOUD_SMTP_USER
        ? { user: env.CLOUD_SMTP_USER, password: env.CLOUD_SMTP_PASSWORD }
        : {}),
      from: env.CLOUD_SMTP_FROM.trim(),
    };
  }
  return {
    host: env.CLOUD_HOST?.trim() || '127.0.0.1',
    port,
    origin: origin.origin,
    secret,
    databasePath: resolve(workspaceDirectory, env.CLOUD_DB_PATH || '.data/cloud/auth.sqlite'),
    websiteDirectory: resolve(workspaceDirectory, env.CLOUD_WEBSITE_DIR || 'apps/website/dist'),
    allowSignup: flag(env.CLOUD_ALLOW_SIGNUP, 'CLOUD_ALLOW_SIGNUP'),
    trustProxy: flag(env.CLOUD_TRUST_PROXY, 'CLOUD_TRUST_PROXY'),
    embedOrigins: readEmbedOrigins(env.CLOUD_EMBED_ORIGINS, env.NODE_ENV === 'production'),
    smtp,
  };
}
