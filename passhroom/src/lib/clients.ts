import argon2 from 'argon2';

export type ClientRow = {
  client_id: string;
  client_secret_hash: string;
  redirect_uris: string[];
  allowed_origins: string[];
  is_enabled: boolean;
  app_name?: string | null;
  email_subject?: string | null;
  email_button_color?: string | null;
  email_logo_png?: Buffer | null;
};

export function redirectUriAllowed(client: ClientRow, redirectUri: string): boolean {
  return Array.isArray(client.redirect_uris) && client.redirect_uris.includes(redirectUri);
}

export function originAllowed(client: ClientRow, origin: string): boolean {
  return Array.isArray(client.allowed_origins) && client.allowed_origins.includes(origin);
}

export async function verifyClientSecret(client: ClientRow, secret: string): Promise<boolean> {
  return argon2.verify(client.client_secret_hash, secret);
}

