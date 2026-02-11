import { FastifyInstance } from 'fastify';
import { env } from '../lib/env';
import { originAllowed, redirectUriAllowed, verifyClientSecret } from '../lib/clients';
import { getClient } from '../lib/clientsRepo';
import { normalizeEmail } from '../lib/users';
import { getOrCreateUserByEmail } from '../lib/usersRepo';
import { randomToken, redactEmail, sha256Base64Url } from '../lib/crypto';
import { pool } from '../lib/db';
import { rateLimitStartLogin } from '../lib/rateLimit';
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
    const expiresAt = new Date(Date.now() + env.tokenTtlMinutes * 60 * 1000);

    await pool.query(
      `INSERT INTO login_requests
         (client_id, user_id, redirect_uri, state, app_return_to, magic_token_hash, code_hash, expires_at, attempts, ip, user_agent)
       VALUES
         ($1, $2, $3, $4, $5, $6, NULL, $7, 0, $8, $9)`,
      [
        body.client_id,
        user.id,
        body.redirect_uri,
        body.state,
        body.app_return_to ?? null,
        magicHash,
        expiresAt,
        ip,
        req.headers['user-agent'] ?? null
      ]
    );

    const magicLinkUrl = `${env.publicBaseUrl}/magic?t=${encodeURIComponent(magicToken)}`;
    const sendResult = await sendMagicLinkEmail({
      toEmail: emailNormalized,
      magicLinkUrl,
      appName: body.app_name,
      clientId: body.client_id,
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
