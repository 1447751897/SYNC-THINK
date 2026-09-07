import nodemailer from 'nodemailer';
import type { SmtpConfig } from './config.js';

export interface AuthMail {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (mail: AuthMail) => Promise<void>;

export function createSmtpSender(config: SmtpConfig): { send: SendMail; close(): void } {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    send: async (mail) => {
      await transport.sendMail({ ...mail, from: config.from });
    },
    close: () => transport.close(),
  };
}
