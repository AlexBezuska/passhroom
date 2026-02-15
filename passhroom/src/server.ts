import fastify from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { env } from './lib/env';
import { registerHealthz } from './routes/healthz';
import { registerAuth } from './routes/auth';
import { registerAdmin } from './routes/admin';

export async function buildServer() {
  const app = fastify({
    logger:
      env.nodeEnv === 'development'
        ? {
            level: 'info',
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard' }
            }
          }
        : { level: 'info' }
  });

  await app.register(sensible);

  // Needed for HTML form posts (e.g. /admin/login/start)
  await app.register(formbody);

  // Needed for admin app branding uploads (PNG logo per app)
  await app.register(multipart, {
    limits: {
      fileSize: 512 * 1024 // 512KB
    }
  });

  // Static assets (favicons, manifest, etc)
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'assets'),
    prefix: '/assets/',
    decorateReply: false
  });

  // Vendor static assets (served from npm deps; used by admin UI)
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'node_modules', 'vanilla-picker', 'dist'),
    prefix: '/vendor/vanilla-picker/',
    decorateReply: false
  });

  // Favicon convenience routes (some browsers request these exact paths)
  app.get('/favicon.png', async (_req, reply) => {
    // Keep this easy to refresh after deploys; favicons are heavily cached by browsers.
    reply.header('cache-control', 'public, max-age=0, must-revalidate');
    return reply.redirect('/assets/favicons/favicon-196.png', 302);
  });

  app.get('/favicon.ico', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=0, must-revalidate');
    return reply.redirect('/assets/favicons/favicon-196.png', 302);
  });

  await app.register(cookie, {
    secret: env.cookieSecret,
    hook: 'onRequest'
  });

  // Default deny; we conditionally set allow-origin in routes.
  await app.register(cors, {
    origin: false
  });

  app.addHook('onRequest', async (req, reply) => {
    if (!env.requireHttps) return;
    if (env.nodeEnv !== 'production') return;
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? '';
    if (proto.toLowerCase() !== 'https') {
      reply.code(400);
      throw new Error('HTTPS required');
    }
  });

  await registerHealthz(app);
  await registerAuth(app);
  await registerAdmin(app);

  return app;
}

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
