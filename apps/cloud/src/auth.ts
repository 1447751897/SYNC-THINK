import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import type { CloudConfig } from './config.js';
import { createSmtpSender, type AuthMail, type SendMail } from './mail.js';

export interface AuthServiceOptions {
  sendMail?: SendMail;
  onLog?: (event: string) => void;
}

export interface AuthService {
  handler(request: Request): Promise<Response>;
  hasSession(headers: Headers): Promise<boolean>;
  close(): Promise<void>;
}

export async function createAuthService(
  config: CloudConfig,
  options: AuthServiceOptions,
): Promise<AuthService | undefined> {
  if (!config.secret) return undefined;
  await mkdir(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const database = new Database(config.databasePath);
  await chmod(config.databasePath, 0o600);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  const smtp = config.smtp && !options.sendMail ? createSmtpSender(config.smtp) : undefined;
  const sendMail = options.sendMail ?? smtp?.send;
  const mailJobs = new Set<Promise<void>>();
  const enqueue = (mail: AuthMail): void => {
    if (!sendMail || !config.smtp) throw new Error('Email delivery is not configured');
    const job = Promise.resolve()
      .then(() => sendMail(mail))
      .catch(() => {
        options.onLog?.('cloud.email.delivery_failed');
      });
    mailJobs.add(job);
    void job.finally(() => mailJobs.delete(job));
  };
  const authOptions = {
    appName: 'SYNC-THINK',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    database,
    trustedOrigins: [config.origin],
    telemetry: { enabled: false },
    logger: {
      level: 'error',
      log: () => options.onLog?.('cloud.auth.error'),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.allowSignup || !config.smtp,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: async ({ user, url }) => {
        enqueue({
          to: user.email,
          subject: 'Reset your SYNC-THINK password',
          text: `Reset your password using this link:\n${url}\n\nThis link expires in 30 minutes. Ignore this email if you did not request it.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        enqueue({
          to: user.email,
          subject: 'Verify your SYNC-THINK email',
          text: `Verify your email using this link:\n${url}\n\nThis link expires in one hour. Ignore this email if you did not register.`,
        });
      },
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    verification: { storeIdentifier: 'hashed' },
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/reset-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      disableCSRFCheck: false,
      disableOriginCheck: false,
      cookiePrefix: 'sync-think',
      useSecureCookies: config.origin.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['x-sync-think-client-ip'] },
    },
  } satisfies BetterAuthOptions;
  try {
    const migration = await getMigrations(authOptions);
    await migration.runMigrations();
    const auth = betterAuth(authOptions);
    return {
      handler: (request) => auth.handler(request),
      hasSession: async (headers) =>
        Boolean((await auth.api.getSession({ headers }))?.user.emailVerified),
      close: async () => {
        await Promise.allSettled(mailJobs);
        smtp?.close();
        database.close();
      },
    };
  } catch (error) {
    smtp?.close();
    database.close();
    throw error;
  }
}
