import nodemailer from 'nodemailer';
import { env } from './env';

export type SendMagicLinkInput = {
  toEmail: string;
  magicLinkUrl: string;
  appName?: string;
  clientId?: string;
  subjectOverride?: string;
  buttonColor?: string;
  logoPng?: Buffer;
  code6?: string;
  codeEntryUrl?: string;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendMagicLinkEmail(input: SendMagicLinkInput): Promise<SendMagicLinkResult> {
  const appLabel = (input.appName ?? '').trim() || (input.clientId ?? '').trim();
  const displayName = appLabel || env.smtp.fromName;

  const subject = (input.subjectOverride ?? '').trim() || `Sign in to ${displayName}`;
  const appLine = appLabel ? `\nApp: ${appLabel}\n` : '';

  const codeLine = input.code6 ? `\nCode: ${input.code6}\n` : '';
  const codeEntryLine = input.codeEntryUrl ? `\nEnter it here: ${input.codeEntryUrl}\n` : '';

  const text =
    `Sign in to ${displayName}\n\n` +
    `Click this link to sign in:${appLine}\n${input.magicLinkUrl}\n\n` +
    (input.code6
      ? `Or use this one-time code:${codeLine}${codeEntryLine}\n`
      : '') +
    `This link expires in ${input.expiresMinutes} minutes.\n\n` +
    `Didn't request this? You can ignore this email.\n\n` +
    `—\n` +
    `${env.smtp.from} is the email address used by Passhroom, the passwordless login system this website uses to make logins and accounts super easy because passwords suck!`;

  const safeDisplayName = escapeHtml(displayName);
  const safeAppLabel = escapeHtml(appLabel);
  const safeMagicLinkUrl = escapeHtml(input.magicLinkUrl);
  const safeFromAddress = escapeHtml(env.smtp.from);
  const expires = escapeHtml(String(input.expiresMinutes));

  const safeSubject = escapeHtml(subject);
  const safeCode6 = escapeHtml(String(input.code6 ?? ''));
  const safeCodeEntryUrl = escapeHtml(String(input.codeEntryUrl ?? ''));

  const codeHtml = input.code6
    ? `<div style="margin-top:16px; padding:14px; background:#FAF7FD; border:1px solid #E6DDF0; border-radius:14px;">
         <div style="font-size:12px; color:#6C4F79; font-weight:700; letter-spacing:0.2px;">One-time code</div>
         <div style="margin-top:10px; display:inline-block; background:#ffffff; border:1px solid #E6DDF0; border-radius:14px; padding:10px 14px; font-size:22px; font-weight:800; letter-spacing:2px; color:#2D0D3C; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;">
           ${safeCode6}
         </div>
         ${input.codeEntryUrl ? `<div style="margin-top:10px; font-size:12px; line-height:1.5; color:#6C4F79;">Enter it here: <a href="${safeCodeEntryUrl}" style="color:#7D3998; text-decoration:none;">${safeCodeEntryUrl}</a></div>` : ''}
       </div>`
    : '';

  // Email clients vary wildly; keep this simple and inline-styled.
  // Pastel purple button (requested).
  const buttonColor = (input.buttonColor ?? '').trim() || '#B79AD0';

  const useLogo = Boolean(input.logoPng && input.logoPng.length > 0);
  const logoHtml = useLogo
    ? `<div style="margin:0 0 14px;">
         <img src="cid:app-logo" alt="${safeDisplayName} logo" width="44" height="44" style="display:block; width:44px; height:44px; border-radius:12px; border:1px solid #E6DDF0; background:#ffffff;" />
       </div>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0; padding:0; background:#f6f1fb; color:#2D0D3C; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; max-width:560px;">
            <tr>
              <td style="padding:0 4px 14px; font-size:22px; font-weight:800; letter-spacing:0.2px;">
                Sign in to ${safeDisplayName}
              </td>
            </tr>

            <tr>
              <td style="background:#ffffff; border:1px solid #E6DDF0; border-radius:16px; padding:22px; box-shadow: 0 12px 32px rgba(45,13,60,0.08);">
                ${logoHtml}
                <div style="font-size:15px; line-height:1.5; color:#2D0D3C;">
                  Use the button below to finish signing in.
                </div>

                ${appLabel ? `<div style="margin-top:10px; font-size:13px; color:#6C4F79;">App: <strong style="color:#2D0D3C;">${safeAppLabel}</strong></div>` : ''}

                <div style="margin-top:18px;">
                  <a href="${safeMagicLinkUrl}"
                     style="display:inline-block; background:${escapeHtml(buttonColor)}; color:#ffffff; text-decoration:none; padding:12px 18px; border-radius:12px; font-weight:700; font-size:15px;">
                    Sign in
                  </a>
                </div>

                ${codeHtml}

                <div style="margin-top:14px; font-size:12px; line-height:1.5; color:#6C4F79;">
                  This link expires in <strong style="color:#2D0D3C;">${expires} minutes</strong>.
                </div>

                <div style="margin-top:18px; font-size:12px; line-height:1.55; color:#6C4F79;">
                  If the button doesn't work, copy and paste this link into your browser:
                  <div style="margin-top:8px; padding:10px 12px; background:#FAF7FD; border:1px solid #E6DDF0; border-radius:12px; word-break:break-all; color:#2D0D3C; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;">
                    ${safeMagicLinkUrl}
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 8px 0; font-size:11px; line-height:1.55; color:#7A6488;">
                <div style="margin-top:8px;">
                  <strong style="color:#2D0D3C;">Fine print:</strong>
                  ${safeFromAddress} is the email address used by <strong style="color:#2D0D3C;">Passhroom</strong>, the passwordless login system.
                  This website uses Passhroom to make logins and accounts super easy because passwords suck!
                </div>
                <div style="margin-top:10px;">
                  Didn't request this email? You can safely ignore it.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const info = await transport.sendMail({
    from: {
      name: displayName,
      address: env.smtp.from
    },
    to: input.toEmail,
    subject,
    text,
    html,
    attachments: useLogo
      ? [
          {
            filename: 'logo.png',
            content: input.logoPng as Buffer,
            contentType: 'image/png',
            cid: 'app-logo'
          }
        ]
      : undefined
  });

  // Nodemailer returns accepted/rejected arrays; useful for diagnosing SMTP issues.
  return {
    messageId: String((info as any).messageId ?? ''),
    accepted: Array.isArray((info as any).accepted) ? ((info as any).accepted as string[]) : [],
    rejected: Array.isArray((info as any).rejected) ? ((info as any).rejected as string[]) : []
  };
}
