import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../env.js';

export type Email = {
  to: string;
  subject: string;
  text: string;
};

export interface EmailSender {
  send(email: Email): Promise<void>;
}

/**
 * Logs the email to stdout — useful for dev and as a no-SMTP default.
 * Production deployments should swap in an SMTP-backed sender.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(email: Email): Promise<void> {
    console.log(
      [
        '--- e-mail (console sender) ---',
        `To: ${email.to}`,
        `Subject: ${email.subject}`,
        '',
        email.text,
        '--- /e-mail ---',
      ].join('\n'),
    );
  }
}

export type SmtpConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure?: boolean;
};

export class SmtpEmailSender implements EmailSender {
  private transporter: Transporter;

  constructor(private config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure ?? config.port === 465,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(email: Email): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  }
}

/**
 * Picks SMTP when all required env vars are present, otherwise falls back
 * to console. Lets dev/test work out-of-the-box and production wire in
 * real delivery via env vars only.
 */
export function createEmailSender(env: Env): EmailSender {
  if (env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM) {
    return new SmtpEmailSender({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    });
  }
  return new ConsoleEmailSender();
}
