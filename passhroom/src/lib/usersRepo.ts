import { pool } from './db';
import type { UserRow } from './users';

export async function getOrCreateUserByEmail(emailNormalized: string): Promise<{ user: UserRow; created: boolean }> {
  const existing = await pool.query('SELECT id, email_normalized, created_at FROM users WHERE email_normalized = $1', [
    emailNormalized
  ]);
  if (existing.rowCount === 1) return { user: existing.rows[0] as UserRow, created: false };

  const inserted = await pool.query(
    'INSERT INTO users (email_normalized) VALUES ($1) RETURNING id, email_normalized, created_at',
    [emailNormalized]
  );
  return { user: inserted.rows[0] as UserRow, created: true };
}
