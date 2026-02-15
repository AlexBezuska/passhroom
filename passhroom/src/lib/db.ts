import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({
  connectionString: env.databaseUrl
});

export async function dbHealthcheck(): Promise<boolean> {
  const result = await pool.query('SELECT 1 as ok');
  return result.rowCount === 1;
}
