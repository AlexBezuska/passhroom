import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { env } from '../lib/env';
import { originAllowed, redirectUriAllowed, verifyClientSecret } from '../lib/clients';
import { getClient } from '../lib/clientsRepo';
import { normalizeEmail } from '../lib/users';
import { getOrCreateUserByEmail } from '../lib/usersRepo';
import { normalizeLoginCode, randomToken, redactEmail, sha256Base64Url } from '../lib/crypto';
import { pool } from '../lib/db';
import { rateLimitStartLogin, rateLimitVerifyCode } from '../lib/rateLimit';
import { sendMagicLinkEmail } from '../lib/email';

function random6DigitCode(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

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
    // Also generate a short code for cross-device / manual entry flows.
    // We store only a hash, same as tokens.
    let code6 = random6DigitCode();
    // Best-effort uniqueness among active requests.
    for (let i = 0; i < 4; i++) {
      const existing = await pool.query(
        `SELECT 1
         FROM login_requests
         WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1`,
        [sha256Base64Url(normalizeLoginCode(code6))]
      );
      if (existing.rowCount === 0) break;
      code6 = random6DigitCode();
    }
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
    const codeEntryUrl = `${env.publicBaseUrl}/code?email=${encodeURIComponent(emailNormalized)}&c=${encodeURIComponent(code6)}`;
    const sendResult = await sendMagicLinkEmail({
      toEmail: emailNormalized,
      magicLinkUrl,
      appName: body.app_name ?? client.app_name ?? undefined,
      clientId: body.client_id,
      subjectOverride: client.email_subject ?? undefined,
      buttonColor: client.email_button_color ?? undefined,
      logoPng: client.email_logo_png ?? undefined,
      code6,
      codeEntryUrl,
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
      message: created
        ? 'Created account and sent you an email with a magic link and a 6-digit code.'
        : 'We sent you an email with a magic link and a 6-digit code.'
    });
  });

  // Code entry page (cross-device / manual flow)
  app.get('/code', async (req, reply) => {
    const q = (req.query ?? {}) as { email?: string; c?: string };
    const email = String(q.email ?? '').trim();
    const codePrefill = String(q.c ?? '').trim();
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Enter sign-in code</title>
    <style>
      body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f1fb;color:#2D0D3C;margin:0;padding:24px}
      .wrap{max-width:520px;margin:0 auto}
      .card{background:#fff;border:1px solid #E6DDF0;border-radius:16px;padding:18px;box-shadow:0 12px 32px rgba(45,13,60,0.08)}
      h1{margin:0 0 6px;font-size:20px}
      label{display:block;margin-top:12px;font-size:13px;color:#6C4F79}
      input{width:100%;border:1px solid #E6DDF0;border-radius:12px;padding:12px 12px;font-size:16px;outline:none}
      input:focus{border-color:#B79AD0;box-shadow:0 0 0 3px rgba(183,154,208,0.25)}
      .btn{margin-top:14px;display:inline-block;background:#B79AD0;color:#fff;border:0;border-radius:12px;padding:12px 16px;font-weight:700;font-size:15px;cursor:pointer}
      .muted{margin-top:10px;font-size:12px;color:#7A6488;line-height:1.5}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Enter your sign-in code</h1>
        <div class="muted">Use the 6-digit code from the email.</div>
        <form method="post" action="/code">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" required value="${email.replace(/"/g,'&quot;')}">
          <label for="code">Code</label>
          <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" required value="${codePrefill.replace(/"/g,'&quot;')}">
          <button class="btn" type="submit">Continue</button>
        </form>
        <div class="muted">If you didn't request this, you can ignore it.</div>
      </div>
    </div>
  </body>
</html>`);
  });

  app.post('/code', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; code?: string };
    const emailNormalized = normalizeEmail(String(body.email ?? ''));
    const codeRaw = String(body.code ?? '');
    const codeNorm = normalizeLoginCode(codeRaw);
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;

    const rl = await rateLimitVerifyCode({ ip, emailNormalized });
    if (!rl.ok) return reply.code(429).header('Retry-After', String(rl.retryAfterSeconds)).send('Rate limited. Try again soon.');

    if (!emailNormalized || !codeNorm) return reply.code(400).send('Missing email or code');

    const codeHash = sha256Base64Url(codeNorm);
    const found = await pool.query(
      `SELECT lr.id, lr.client_id, lr.user_id, lr.redirect_uri, lr.state, lr.expires_at, lr.used_at, lr.attempts
       FROM login_requests lr
       JOIN users u ON u.id = lr.user_id
       WHERE u.email_normalized = $1 AND lr.code_hash = $2
       ORDER BY lr.created_at DESC
       LIMIT 1`,
      [emailNormalized, codeHash]
    );
    if (found.rowCount !== 1) return reply.code(400).send('Invalid or expired code');

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

    await pool.query('UPDATE login_requests SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    if (row.used_at) return reply.code(400).send('Code already used');
    if (row.expires_at.getTime() <= Date.now()) return reply.code(400).send('Code expired');
    if (row.attempts >= env.maxMagicAttempts) return reply.code(400).send('Too many attempts');

    await pool.query('UPDATE login_requests SET used_at = NOW() WHERE id = $1 AND used_at IS NULL', [row.id]);

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
