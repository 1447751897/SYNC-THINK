/**
 * OAuth provider registry.
 *
 * Keyed by the `providerId` the renderer catalog carries
 * (`apps/desktop/src/renderer/shell/connector-catalog.ts`), never by catalog
 * entry id: a single Google client backs Docs, Gmail, Drive and Calendar, so
 * the client credentials are stored once per provider and only the requested
 * scopes differ between entries.
 *
 * This file holds endpoints and protocol quirks. It never holds a client id or
 * secret — those are the user's, supplied through `oauth.clientConfig.save`.
 *
 * The table is deliberately plain data: adding a provider is one entry, and a
 * provider whose endpoint differs from what is written here is corrected by
 * editing this entry rather than touching the broker.
 */

/** How the token request authenticates the confidential client. */
export type OauthTokenAuth = 'basic' | 'body';

export interface OAuthProviderDefinition {
  id: string;
  /** Shown in the settings dialog. */
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Where the user registers an OAuth app; surfaced as a link in the dialog. */
  consoleUrl?: string;
  /**
   * Notion — and any provider with no scope concept — rejects a `scope`
   * parameter outright. Catalog entries for these carry an empty scope string
   * and the broker omits the parameter entirely.
   */
  supportsScope: boolean;
  /**
   * PKCE support. Where a provider accepts it we always send it: the loopback
   * redirect is a public channel, and `client_secret` travelling alongside a
   * code is exactly the replay PKCE exists to stop.
   */
  pkce: boolean;
  tokenAuth: OauthTokenAuth;
  /** Google-style: without an offline grant a repeat consent returns no refresh token. */
  offlineAccess?: boolean;
  /** Query params the provider documents as required at authorize time. */
  authorizeParams?: Readonly<Record<string, string>>;
  /** Extra form fields the token request requires. */
  tokenParams?: Readonly<Record<string, string>>;
  /**
   * Value substituted for `{tenant}` in the endpoint templates when the user
   * has not supplied one. Endpoints without the placeholder ignore it.
   */
  tenantDefault?: string;
}

/**
 * Endpoints below are the providers' documented production values. A provider
 * that changes its authorization server is a one-line edit here.
 */
export const OAUTH_PROVIDERS: Readonly<Record<string, OAuthProviderDefinition>> = {
  github: {
    id: 'github',
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    consoleUrl: 'https://github.com/settings/developers',
    supportsScope: true,
    // GitHub OAuth Apps have no PKCE; their reply is authenticated by the
    // client secret instead. Requesting a challenge would be ignored.
    pkce: false,
    tokenAuth: 'body',
  },
  gitlab: {
    id: 'gitlab',
    label: 'GitLab',
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    consoleUrl: 'https://gitlab.com/-/user_settings/applications',
    supportsScope: true,
    pkce: true,
    tokenAuth: 'body',
  },
  gitee: {
    id: 'gitee',
    label: 'Gitee 码云',
    authorizeUrl: 'https://gitee.com/oauth/authorize',
    tokenUrl: 'https://gitee.com/oauth/token',
    consoleUrl: 'https://gitee.com/oauth/applications',
    supportsScope: true,
    // Gitee documents `code_verifier` on the token request but is inconsistent
    // about advertising the challenge, so we keep the plain confidential flow.
    pkce: false,
    tokenAuth: 'body',
  },
  linear: {
    id: 'linear',
    label: 'Linear',
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    consoleUrl: 'https://linear.app/settings/api/applications',
    supportsScope: true,
    pkce: true,
    tokenAuth: 'body',
  },
  atlassian: {
    id: 'atlassian',
    label: 'Atlassian (Jira)',
    authorizeUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    consoleUrl: 'https://developer.atlassian.com/console/myapps/',
    supportsScope: true,
    pkce: true,
    tokenAuth: 'body',
    // Atlassian refuses to issue a token without an explicit audience, and
    // silently reuses the previous grant unless consent is forced.
    authorizeParams: { audience: 'api.atlassian.com', prompt: 'consent' },
  },
  notion: {
    id: 'notion',
    label: 'Notion',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    consoleUrl: 'https://www.notion.so/my-integrations',
    supportsScope: false,
    pkce: false,
    tokenAuth: 'basic',
    authorizeParams: { owner: 'user' },
  },
  google: {
    id: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    supportsScope: true,
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: true,
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    consoleUrl: 'https://api.slack.com/apps',
    supportsScope: true,
    pkce: false,
    tokenAuth: 'body',
  },
  discord: {
    id: 'discord',
    label: 'Discord',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    consoleUrl: 'https://discord.com/developers/applications',
    supportsScope: true,
    pkce: true,
    tokenAuth: 'body',
  },
  microsoft: {
    id: 'microsoft',
    label: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    consoleUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    supportsScope: true,
    pkce: true,
    tokenAuth: 'body',
    offlineAccess: true,
    tenantDefault: 'common',
  },
  figma: {
    id: 'figma',
    label: 'Figma',
    authorizeUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://api.figma.com/v1/oauth/token',
    consoleUrl: 'https://www.figma.com/developers/apps',
    supportsScope: true,
    pkce: false,
    tokenAuth: 'basic',
  },
  vercel: {
    id: 'vercel',
    label: 'Vercel',
    authorizeUrl: 'https://vercel.com/oauth/authorize',
    tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
    consoleUrl: 'https://vercel.com/account/integrations',
    supportsScope: true,
    pkce: false,
    tokenAuth: 'body',
  },
  sentry: {
    id: 'sentry',
    label: 'Sentry',
    authorizeUrl: 'https://sentry.io/oauth/authorize/',
    tokenUrl: 'https://sentry.io/oauth/token/',
    consoleUrl: 'https://sentry.io/settings/account/api/applications/',
    supportsScope: true,
    pkce: true,
    tokenAuth: 'body',
  },
  datadog: {
    id: 'datadog',
    label: 'Datadog',
    // Datadog's authorization server is per-site, so the template carries the
    // site and the default is the US1 commercial site. EU users set
    // `tenant: 'datadoghq.eu'` on the client config.
    authorizeUrl: 'https://app.{tenant}/oauth2/v1/authorize',
    tokenUrl: 'https://api.{tenant}/oauth2/v1/token',
    consoleUrl: 'https://app.datadoghq.com/organization-settings/oauth-applications',
    supportsScope: true,
    pkce: false,
    tokenAuth: 'basic',
    tenantDefault: 'datadoghq.com',
  },
  clickup: {
    id: 'clickup',
    label: 'ClickUp',
    authorizeUrl: 'https://app.clickup.com/api',
    tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
    consoleUrl: 'https://app.clickup.com/settings/apps',
    supportsScope: false,
    pkce: false,
    tokenAuth: 'body',
  },
};

export function getOAuthProvider(providerId: string): OAuthProviderDefinition | undefined {
  return OAUTH_PROVIDERS[providerId];
}

export function listOAuthProviderIds(): string[] {
  return Object.keys(OAUTH_PROVIDERS).sort();
}

/**
 * Substitute the tenant/site placeholder.
 *
 * A template without the placeholder returns unchanged, so callers do not need
 * to know which providers are parameterised. The value is URL-encoded because
 * it lands in a host segment that the user typed.
 */
export function resolveProviderEndpoint(
  template: string,
  tenant: string | undefined,
  fallback: string | undefined,
): string {
  if (!template.includes('{tenant}')) return template;
  const value = tenant?.trim() || fallback || 'common';
  return template.replaceAll('{tenant}', encodeURIComponent(value));
}
