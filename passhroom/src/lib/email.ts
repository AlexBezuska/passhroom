import nodemailer from 'nodemailer';
import { env } from './env';

export type SendMagicLinkInput = {
  toEmail: string;
  magicLinkUrl: string;
  code6?: string;
  codeEntryUrl?: string;
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
  const subject = input.code6 ? 'Your sign-in code' : 'Your sign-in link';
  const appLine = input.appName ? `\nApp: ${input.appName}\n` : '';

  const text = input.code6
    ? `Sign in using either option below:${appLine}
Option A (recommended): click the sign-in link
${input.magicLinkUrl}

Option B: enter this code
${input.code6}

${input.codeEntryUrl ? `Enter code here: ${input.codeEntryUrl}\n\n` : ''}This email expires in ${input.expiresMinutes} minutes.`
    : `Use this link to sign in:${appLine}\n${input.magicLinkUrl}\n\nThis link expires in ${input.expiresMinutes} minutes.`;

  const safeAppName = input.appName ? String(input.appName) : 'Passhroom';
  const html = input.code6
    ? `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#0b0b10; color:#e9e9f1; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;">
    <div style="max-width:640px; margin:0 auto; padding:24px 16px;">
      <div style="background:#12121b; border:1px solid rgba(255,255,255,0.10); border-radius:16px; padding:18px;">
        <div style="font-size:14px; color:rgba(233,233,241,0.72);">${safeAppName}</div>
        <h1 style="margin:8px 0 0 0; font-size:20px;">Sign in</h1>
        <p style="margin:10px 0 0 0; color:rgba(233,233,241,0.72); font-size:14px;">Use either the link or the code below. Both expire in ${input.expiresMinutes} minutes.</p>

        <div style="margin-top:14px;">
          <a href="${input.magicLinkUrl}" style="display:inline-block; padding:12px 14px; border-radius:12px; border:1px solid rgba(255,43,214,0.55); background: rgba(255,43,214,0.12); color:#e9e9f1; text-decoration:none; font-weight:700;">Sign in with link</a>
        </div>

        <div style="margin-top:16px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.10);">
          <div style="font-size:14px; color:rgba(233,233,241,0.72);">Code</div>
          <div style="margin-top:10px; border:1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.18); border-radius: 14px; padding: 14px 14px; font-size:28px; font-weight:900; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; word-break: break-word; line-height: 1.15;">${input.code6}</div>
          ${input.codeEntryUrl ? `<div style="margin-top:10px;"><a href="${input.codeEntryUrl}" style="color:#ff2bd6; text-decoration:none;">Enter code on Passhroom</a></div>` : ''}
          <div style="margin-top:10px; font-size:12px; color:rgba(233,233,241,0.60);">If you click the link, the code becomes invalid. If you use the code, the link becomes invalid.</div>
        </div>
      </div>
    </div>
  </body>
</html>`
    : undefined;

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
