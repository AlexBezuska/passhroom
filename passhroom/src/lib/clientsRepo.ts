import { pool } from './db';
import type { ClientRow } from './clients';

export async function getClient(clientId: string): Promise<ClientRow | null> {
  const result = await pool.query(
    'SELECT client_id, client_secret_hash, redirect_uris, allowed_origins, is_enabled, app_name, email_subject, email_button_color, email_logo_png FROM clients WHERE client_id = $1',
    [clientId]
  );
  return (result.rows[0] as ClientRow | undefined) ?? null;
}
