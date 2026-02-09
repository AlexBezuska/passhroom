import nodemailer from 'nodemailer';
import { env } from './env';

export type SendMagicLinkInput = {
  toEmail: string;
  magicLinkUrl: string;
  appName?: string;
  expiresMinutes: number;
};

export type SendMagicLinkResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
};

const transport = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.port === 465,
  auth: {
    user: env.smtp.user,
    pass: env.smtp.pass
  }
});

export async function sendMagicLinkEmail(input: SendMagicLinkInput): Promise<SendMagicLinkResult> {
  const subject = 'Your sign-in link';
  const appLine = input.appName ? `\nApp: ${input.appName}\n` : '';

  const text = `Use this link to sign in:${appLine}\n${input.magicLinkUrl}\n\nThis link expires in ${input.expiresMinutes} minutes.`;

  const html = undefined;

  const info = await transport.sendMail({
    from: `${env.smtp.fromName} <${env.smtp.from}>`,
    to: input.toEmail,
    subject,
    text,
    html
  });

  // Nodemailer returns accepted/rejected arrays; useful for diagnosing SMTP issues.
  return {
    messageId: String((info as any).messageId ?? ''),
    accepted: Array.isArray((info as any).accepted) ? ((info as any).accepted as string[]) : [],
    rejected: Array.isArray((info as any).rejected) ? ((info as any).rejected as string[]) : []
  };
}
