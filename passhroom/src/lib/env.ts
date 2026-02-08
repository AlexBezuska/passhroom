import 'dotenv/config';

function mustGet(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function getInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid int for ${name}: ${raw}`);
  return parsed;
}

function getOptional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === '') return undefined;
  return value;
}

function getCsv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: getInt('PORT', 8080),

  cookieSecret: mustGet('COOKIE_SECRET'),

  databaseUrl: mustGet('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL,

  publicBaseUrl: mustGet('PASSHROOM_PUBLIC_BASE_URL').replace(/\/$/, ''),

  smtp: {
    host: mustGet('SMTP_HOST'),
    port: getInt('SMTP_PORT', 587),
    user: mustGet('SMTP_USER'),
    pass: mustGet('SMTP_PASS'),
    from: mustGet('SMTP_FROM'),
    fromName: process.env.SMTP_FROM_NAME ?? 'Passhroom'
  },

  tokenTtlMinutes: getInt('TOKEN_TTL_MINUTES', 10),
  codeTtlMinutes: getInt('CODE_TTL_MINUTES', 5),
  requireHttps: getBool('REQUIRE_HTTPS', true),
  logRedactPii: getBool('LOG_REDACT_PII', true),
  resendCooldownSeconds: getInt('RESEND_COOLDOWN_SECONDS', 60),
  maxMagicAttempts: getInt('MAX_MAGIC_ATTEMPTS', 5),

  admin: {
    enabled: getBool('ADMIN_ENABLED', true),
    loginTtlMinutes: getInt('ADMIN_LOGIN_TTL_MINUTES', 10),
    sessionTtlHours: getInt('ADMIN_SESSION_TTL_HOURS', 12),
    emailAllowlist: getCsv('ADMIN_EMAIL_ALLOWLIST'),
    // Optional extra protection for the admin dashboard.
    // If set, requests to /admin must include this header with the same value.
    // Example: ADMIN_REQUIRE_HEADER_NAME=X-Admin-Key and ADMIN_REQUIRE_HEADER_VALUE=...random...
    requireHeaderName: getOptional('ADMIN_REQUIRE_HEADER_NAME'),
    requireHeaderValue: getOptional('ADMIN_REQUIRE_HEADER_VALUE')
  },

  rateLimit: {
    ipPerMinute: getInt('RL_IP_PER_MINUTE', 10),
    emailPerMinute: getInt('RL_EMAIL_PER_MINUTE', 3),
    emailPerHour: getInt('RL_EMAIL_PER_HOUR', 10),
    clientPerMinute: getInt('RL_CLIENT_PER_MINUTE', 20)
  },

  rateLimitBackend: process.env.RATE_LIMIT_BACKEND ?? 'auto' // auto|redis|db
};
