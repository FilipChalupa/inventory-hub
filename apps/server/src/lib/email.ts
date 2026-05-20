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
