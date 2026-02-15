import { FastifyInstance } from 'fastify';
import { dbHealthcheck } from '../lib/db';

export async function registerHealthz(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => {
    const dbOk = await dbHealthcheck();
    return { ok: true, db: dbOk };
  });
}
