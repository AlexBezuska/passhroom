import Redis from 'ioredis';
import { env } from './env';
import { pool } from './db';

type RateLimitKey = {
  scope: 'ip' | 'email' | 'client';
  id: string;
  windowSeconds: number;
};

type Limit = {
  max: number;
  windowSeconds: number;
};

type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

function keyString(key: RateLimitKey): string {
  return `passhroom:rl:${key.scope}:${key.windowSeconds}:${key.id}`;
}

const redis = env.redisUrl ? new Redis(env.redisUrl) : null;

async function useRedis(key: RateLimitKey, limit: Limit): Promise<RateLimitResult> {
  if (!redis) throw new Error('Redis not configured');
  const k = keyString(key);
  const tx = redis.multi();
  tx.incr(k);
  tx.ttl(k);
  const [[, count], [, ttl]] = (await tx.exec()) as unknown as [[null, number], [null, number]];
  if (ttl < 0) await redis.expire(k, limit.windowSeconds);
  if (count <= limit.max) return { ok: true };
  const retryAfterSeconds = ttl > 0 ? ttl : limit.windowSeconds;
  return { ok: false, retryAfterSeconds };
}

async function useDb(key: RateLimitKey, limit: Limit): Promise<RateLimitResult> {
  const now = new Date();
  const result = await pool.query(
    `INSERT INTO rate_limits (scope, scope_id, window_seconds, count, reset_at)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (scope, scope_id, window_seconds)
     DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= $5 THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= $5 THEN $4 ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
    [key.scope, key.id, limit.windowSeconds, new Date(now.getTime() + limit.windowSeconds * 1000), now]
  );

  const row = result.rows[0] as { count: number; reset_at: Date };
  if (row.count <= limit.max) return { ok: true };
  const retryAfterSeconds = Math.max(1, Math.ceil((row.reset_at.getTime() - now.getTime()) / 1000));
  return { ok: false, retryAfterSeconds };
}

function shouldUseRedis(): boolean {
  if (env.rateLimitBackend === 'redis') return true;
  if (env.rateLimitBackend === 'db') return false;
  return Boolean(redis);
}

export async function rateLimitStartLogin(input: {
  ip: string;
  emailNormalized: string;
  clientId: string;
}): Promise<RateLimitResult> {
  const useRedisBackend = shouldUseRedis();

  const limits: Array<{ key: RateLimitKey; limit: Limit }> = [
    {
      key: { scope: 'ip', id: input.ip, windowSeconds: 60 },
      limit: { max: env.rateLimit.ipPerMinute, windowSeconds: 60 }
    },
    {
      key: { scope: 'client', id: input.clientId, windowSeconds: 60 },
      limit: { max: env.rateLimit.clientPerMinute, windowSeconds: 60 }
    },
    {
      key: { scope: 'email', id: input.emailNormalized, windowSeconds: 60 },
      limit: { max: env.rateLimit.emailPerMinute, windowSeconds: 60 }
    },
    {
      key: { scope: 'email', id: input.emailNormalized, windowSeconds: 3600 },
      limit: { max: env.rateLimit.emailPerHour, windowSeconds: 3600 }
    }
  ];

  for (const { key, limit } of limits) {
    const result = useRedisBackend ? await useRedis(key, limit) : await useDb(key, limit);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export async function rateLimitVerifyCode(input: {
  ip: string;
  emailNormalized: string;
}): Promise<RateLimitResult> {
  const useRedisBackend = shouldUseRedis();

  // Same shape as start-login (but no client dimension).
  const limits: Array<{ key: RateLimitKey; limit: Limit }> = [
    {
      key: { scope: 'ip', id: input.ip, windowSeconds: 60 },
      limit: { max: env.rateLimit.ipPerMinute, windowSeconds: 60 }
    },
    {
      key: { scope: 'email', id: input.emailNormalized, windowSeconds: 60 },
      limit: { max: env.rateLimit.emailPerMinute, windowSeconds: 60 }
    },
    {
      key: { scope: 'email', id: input.emailNormalized, windowSeconds: 3600 },
      limit: { max: env.rateLimit.emailPerHour, windowSeconds: 3600 }
    }
  ];

  for (const { key, limit } of limits) {
    const result = useRedisBackend ? await useRedis(key, limit) : await useDb(key, limit);
    if (!result.ok) return result;
  }
  return { ok: true };
}
