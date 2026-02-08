import { FastifyInstance } from 'fastify';
import { env } from '../lib/env';
import { originAllowed, redirectUriAllowed, verifyClientSecret } from '../lib/clients';
import { getClient } from '../lib/clientsRepo';
import { normalizeEmail } from '../lib/users';
import { getOrCreateUserByEmail } from '../lib/usersRepo';
import { normalizeLoginCode, randomMushroomNameCode, randomToken, redactEmail, sha256Base64Url } from '../lib/crypto';
import { pool } from '../lib/db';
import { rateLimitStartLogin, rateLimitVerifyCode } from '../lib/rateLimit';
import { sendMagicLinkEmail } from '../lib/email';

type StartBody = {
  client_id: string;
  email: string;
  redirect_uri: string;
  state: string;
  app_return_to?: string;
  app_name?: string;
};

type TokenBody = {
  client_id: string;
  client_secret: string;
  code: string;
  redirect_uri: string;
};

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.post<{ Body: StartBody }>('/v1/auth/start', async (req, reply) => {
    const body = req.body;
    const client = await getClient(body.client_id);
    if (!client || !client.is_enabled) return reply.code(400).send({ error: 'invalid_client' });
    if (!redirectUriAllowed(client, body.redirect_uri)) return reply.code(400).send({ error: 'invalid_redirect_uri' });

    const origin = req.headers.origin;
    if (origin && originAllowed(client, origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }

    const emailNormalized = normalizeEmail(body.email);
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;

    const rl = await rateLimitStartLogin({ ip, emailNormalized, clientId: body.client_id });
    if (!rl.ok) return reply.code(429).header('Retry-After', String(rl.retryAfterSeconds)).send({ error: 'rate_limited' });

    const { user, created } = await getOrCreateUserByEmail(emailNormalized);

    const cooldownSince = new Date(Date.now() - env.resendCooldownSeconds * 1000);
    const cooldownExisting = await pool.query(
      `SELECT id FROM login_requests
       WHERE client_id = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > NOW() AND created_at > $3
       LIMIT 1`,
      [body.client_id, user.id, cooldownSince]
    );
    if (cooldownExisting.rowCount === 1) {
      req.log.info({ event: 'auth_start_cooldown', client_id: body.client_id, email: redactEmail(emailNormalized) });
      return reply.code(429).send({
        status: 'cooldown',
        user_created: created,
        message: 'A sign-in link was recently sent. Please check your inbox.'
      });
    }

    const magicToken = randomToken(32);
    const magicHash = sha256Base64Url(magicToken);
    const code6 = randomMushroomNameCode();
    const codeHash = sha256Base64Url(normalizeLoginCode(code6));
    const expiresAt = new Date(Date.now() + env.tokenTtlMinutes * 60 * 1000);

    await pool.query(
      `INSERT INTO login_requests
         (client_id, user_id, redirect_uri, state, app_return_to, magic_token_hash, code_hash, expires_at, attempts, ip, user_agent)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10)`,
      [
        body.client_id,
        user.id,
        body.redirect_uri,
        body.state,
        body.app_return_to ?? null,
        magicHash,
        codeHash,
        expiresAt,
        ip,
        req.headers['user-agent'] ?? null
      ]
    );

    const magicLinkUrl = `${env.publicBaseUrl}/magic?t=${encodeURIComponent(magicToken)}`;
    const codeEntryUrl = `${env.publicBaseUrl}/code?email=${encodeURIComponent(emailNormalized)}`;
    const sendResult = await sendMagicLinkEmail({
      toEmail: emailNormalized,
      magicLinkUrl,
      code6,
      codeEntryUrl,
      appName: body.app_name,
      expiresMinutes: env.tokenTtlMinutes
    });

    req.log.info(
      {
        event: 'email_sent',
        kind: 'user_magic_link',
        client_id: body.client_id,
        email: redactEmail(emailNormalized),
        message_id: sendResult.messageId,
        accepted_count: sendResult.accepted.length,
        rejected_count: sendResult.rejected.length
      },
      'SMTP send attempted'
    );

    req.log.info({ event: 'auth_start_ok', client_id: body.client_id, email: redactEmail(emailNormalized), user_created: created });
    return reply.send({
      status: 'ok',
      user_created: created,
      message: created ? 'Created account and sent you an email with a magic link.' : 'We sent you an email with a magic link.'
    });
  });

  // Code entry (alternative to magic link). Always invalidates the link by consuming the same login_request.
  app.get('/code', async (req, reply) => {
    const email = String((req.query as any)?.email ?? '');
    const safeEmail = email.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Passhroom Code Sign-in</title>
  </head>
  <body style="margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#0b0b10; color:#e9e9f1;">
    <div style="max-width:720px; margin:0 auto; padding:22px 16px;">
      <div style="background:#12121b; border:1px solid rgba(255,255,255,0.10); border-radius:16px; padding:18px;">
        <h1 style="margin:0; font-size:20px;">Enter your sign-in code</h1>
        <p style="margin:10px 0 0 0; color:rgba(233,233,241,0.72); font-size:14px;">If you use the code, the email link becomes invalid (and vice versa).</p>
        <form method="post" action="/code" style="margin-top:16px; display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="display:block; font-size:14px; color:rgba(233,233,241,0.72); margin-bottom:6px;" for="email">Email</label>
            <input id="email" name="email" type="email" value="${safeEmail}" autocomplete="email" required
              style="width:100%; padding:12px 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.25); color:#e9e9f1; font-size:16px;" />
          </div>
          <div>
            <label style="display:block; font-size:14px; color:rgba(233,233,241,0.72); margin-bottom:6px;" for="code">Code (mushroom name)</label>
            <input id="code" name="code" type="text" autocomplete="one-time-code" placeholder="Horse Mushroom" required
              style="width:100%; padding:14px 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.25); color:#e9e9f1; font-size:22px; font-weight:800; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;" />
          </div>
          <button type="submit" style="padding:12px 14px; border-radius:12px; border:1px solid rgba(255,43,214,0.55); background: rgba(255,43,214,0.12); color:#e9e9f1; font-weight:800; font-size:16px; cursor:pointer;">Continue</button>
        </form>
      </div>
    </div>
  </body>
</html>`);
  });

  app.post('/code', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; code?: string };
    const emailNormalized = normalizeEmail(String(body.email ?? ''));
    const codeRaw = String(body.code ?? '');
    const codeNormalized = normalizeLoginCode(codeRaw);
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;

    const sendError = (status: number, message: string) => {
      reply.code(status);
      reply.header('content-type', 'text/html; charset=utf-8');
      const safeMsg = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      return reply.send(`<!doctype html><html><body style="margin:0; font-family: ui-sans-serif, system-ui; background:#0b0b10; color:#e9e9f1;"><div style="max-width:720px; margin:0 auto; padding:22px 16px;"><div style="background:#12121b; border:1px solid rgba(255,255,255,0.10); border-radius:16px; padding:18px;"><h1 style="margin:0; font-size:20px;">Code sign-in</h1><p style="margin-top:10px; color:rgba(233,233,241,0.72);">${safeMsg}</p><p style="margin-top:14px;"><a style="color:#ff2bd6; text-decoration:none;" href="/code?email=${encodeURIComponent(
        emailNormalized
      )}">Try again</a></p></div></div></body></html>`);
    };

    if (!emailNormalized) return sendError(400, 'Missing email.');
    if (!codeNormalized) return sendError(400, 'Missing code.');

    const rl = await rateLimitVerifyCode({ ip, emailNormalized });
    if (!rl.ok) {
      reply.header('Retry-After', String(rl.retryAfterSeconds));
      return sendError(429, 'Too many attempts. Please wait a moment and try again.');
    }

    const codeHash = sha256Base64Url(codeNormalized);
    const found = await pool.query(
      `SELECT lr.id, lr.client_id, lr.user_id, lr.redirect_uri, lr.state, lr.expires_at, lr.used_at, lr.attempts
       FROM login_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE u.email_normalized = $1
         AND lr.code_hash = $2
       ORDER BY lr.created_at DESC
       LIMIT 1`,
      [emailNormalized, codeHash]
    );

    if (found.rowCount !== 1) return sendError(400, 'Invalid code (or it already expired).');

    const row = found.rows[0] as {
      id: string;
      client_id: string;
      user_id: string;
      redirect_uri: string;
      state: string;
      expires_at: Date;
      used_at: Date | null;
      attempts: number;
    };

    // Count this validation attempt (best-effort)
    await pool.query('UPDATE login_requests SET attempts = attempts + 1 WHERE id = $1', [row.id]);

    if (row.used_at) return sendError(400, 'This code was already used.');
    if (row.expires_at.getTime() <= Date.now()) return sendError(400, 'This code expired.');
    if (row.attempts >= env.maxMagicAttempts) return sendError(400, 'Too many attempts.');

    // Consume the login request (invalidates the magic link)
    const consumeRes = await pool.query('UPDATE login_requests SET used_at = NOW() WHERE id = $1 AND used_at IS NULL', [row.id]);
    if (consumeRes.rowCount !== 1) return sendError(400, 'This code was already used.');

    const code = randomToken(32);
    const authCodeHash = sha256Base64Url(code);
    const codeExpiresAt = new Date(Date.now() + env.codeTtlMinutes * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_codes (client_id, user_id, redirect_uri, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.client_id, row.user_id, row.redirect_uri, authCodeHash, codeExpiresAt]
    );

    const location = `${row.redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(row.state)}`;
    return reply.redirect(location, 302);
  });

  app.get('/magic', async (req, reply) => {
    const t = (req.query as { t?: string }).t;
    if (!t) return reply.code(400).send('Missing token');

    const tokenHash = sha256Base64Url(t);
    const found = await pool.query(
      `SELECT id, client_id, user_id, redirect_uri, state, expires_at, used_at, attempts
       FROM login_requests
       WHERE magic_token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (found.rowCount !== 1) return reply.code(400).send('Invalid or expired token');
    const row = found.rows[0] as {
      id: string;
      client_id: string;
      user_id: string;
      redirect_uri: string;
      state: string;
      expires_at: Date;
      used_at: Date | null;
      attempts: number;
    };

    // Count this validation attempt (best-effort)
    await pool.query('UPDATE login_requests SET attempts = attempts + 1 WHERE id = $1', [row.id]);

    if (row.used_at) return reply.code(400).send('Token already used');
    if (row.expires_at.getTime() <= Date.now()) return reply.code(400).send('Token expired');
    if (row.attempts >= env.maxMagicAttempts) return reply.code(400).send('Too many attempts');

    // Mark magic as used and mint auth code
    await pool.query('UPDATE login_requests SET used_at = NOW() WHERE id = $1 AND used_at IS NULL', [row.id]);

    const code = randomToken(32);
    const codeHash = sha256Base64Url(code);
    const codeExpiresAt = new Date(Date.now() + env.codeTtlMinutes * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_codes (client_id, user_id, redirect_uri, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.client_id, row.user_id, row.redirect_uri, codeHash, codeExpiresAt]
    );

    req.log.info({ event: 'magic_click_ok', client_id: row.client_id });
    const location = `${row.redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(row.state)}`;
    return reply.redirect(location, 302);
  });

  app.post<{ Body: TokenBody }>('/v1/auth/token', async (req, reply) => {
    const body = req.body;
    const client = await getClient(body.client_id);
    if (!client || !client.is_enabled) return reply.code(400).send({ error: 'invalid_client' });
    if (!redirectUriAllowed(client, body.redirect_uri)) return reply.code(400).send({ error: 'invalid_redirect_uri' });
    if (!(await verifyClientSecret(client, body.client_secret))) return reply.code(401).send({ error: 'invalid_client_secret' });

    const codeHash = sha256Base64Url(body.code);
    const found = await pool.query(
      `SELECT id, user_id, expires_at, used_at
       FROM auth_codes
       WHERE client_id = $1 AND redirect_uri = $2 AND code_hash = $3
       LIMIT 1`,
      [body.client_id, body.redirect_uri, codeHash]
    );
    if (found.rowCount !== 1) return reply.code(400).send({ error: 'invalid_code' });
    const codeRow = found.rows[0] as { id: string; user_id: string; expires_at: Date; used_at: Date | null };
    if (codeRow.used_at) return reply.code(400).send({ error: 'code_used' });
    if (codeRow.expires_at.getTime() <= Date.now()) return reply.code(400).send({ error: 'code_expired' });

    await pool.query('UPDATE auth_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL', [codeRow.id]);
    const userResult = await pool.query('SELECT id, email_normalized FROM users WHERE id = $1', [codeRow.user_id]);
    if (userResult.rowCount !== 1) return reply.code(500).send({ error: 'user_missing' });
    const user = userResult.rows[0] as { id: string; email_normalized: string };

    req.log.info({ event: 'token_exchange_ok', client_id: body.client_id, user_id: user.id });
    return reply.send({
      user_id: user.id,
      email: user.email_normalized,
      issued_at: new Date().toISOString(),
      expires_in: env.codeTtlMinutes * 60
    });
  });
}
