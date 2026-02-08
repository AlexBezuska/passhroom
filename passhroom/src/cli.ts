import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import argon2 from 'argon2';
import { randomToken } from './lib/crypto';
import { pool } from './lib/db';

async function createClient(argv: any) {
  const clientId = String(argv.clientId);
  const redirectUris = (argv.redirectUri as string[] | undefined) ?? [];
  const allowedOrigins = (argv.allowedOrigin as string[] | undefined) ?? [];

  if (!clientId) throw new Error('Missing --client-id');
  if (redirectUris.length === 0) throw new Error('At least one --redirect-uri is required');

  const secret = randomToken(32);
  const secretHash = await argon2.hash(secret);
  await pool.query(
    `INSERT INTO clients (client_id, client_secret_hash, client_secret_plain, redirect_uris, allowed_origins, is_enabled)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, true)`,
    [clientId, secretHash, secret, JSON.stringify(redirectUris), JSON.stringify(allowedOrigins)]
  );

  // Print secret once
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ client_id: clientId, client_secret: secret }, null, 2));
}

async function rotateSecret(argv: any) {
  const clientId = String(argv.clientId);
  const secret = randomToken(32);
  const secretHash = await argon2.hash(secret);
  const result = await pool.query('UPDATE clients SET client_secret_hash = $2, client_secret_plain = $3 WHERE client_id = $1', [clientId, secretHash, secret]);
  if (result.rowCount !== 1) throw new Error('Client not found');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ client_id: clientId, client_secret: secret }, null, 2));
}

async function setEnabled(argv: any, isEnabled: boolean) {
  const clientId = String(argv.clientId);
  const result = await pool.query('UPDATE clients SET is_enabled = $2 WHERE client_id = $1', [clientId, isEnabled]);
  if (result.rowCount !== 1) throw new Error('Client not found');
}

async function addToArrayField(argv: any, field: 'redirect_uris' | 'allowed_origins', value: string) {
  const clientId = String(argv.clientId);
  const result = await pool.query(
    `UPDATE clients
     SET ${field} = (SELECT jsonb_agg(DISTINCT x) FROM (
       SELECT jsonb_array_elements_text(${field}) AS x
       UNION ALL SELECT $2
     ) s)
     WHERE client_id = $1`,
    [clientId, value]
  );
  if (result.rowCount !== 1) throw new Error('Client not found');
}

async function removeFromArrayField(argv: any, field: 'redirect_uris' | 'allowed_origins', value: string) {
  const clientId = String(argv.clientId);
  const result = await pool.query(
    `UPDATE clients
     SET ${field} = (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
       SELECT jsonb_array_elements_text(${field}) AS x
     ) s WHERE x <> $2)
     WHERE client_id = $1`,
    [clientId, value]
  );
  if (result.rowCount !== 1) throw new Error('Client not found');
}

async function main() {
  await yargs(hideBin(process.argv))
    .scriptName('passhroom')
    .command(
      'clients:create',
      'Create a client and print its secret once',
      (y) =>
        y
          .option('client-id', { type: 'string', demandOption: true, alias: 'clientId' })
          .option('redirect-uri', { type: 'array', demandOption: true, alias: 'redirectUri' })
          .option('allowed-origin', { type: 'array', alias: 'allowedOrigin' }),
      createClient
    )
    .command(
      'clients:rotate-secret',
      'Rotate a client secret and print the new secret once',
      (y) => y.option('client-id', { type: 'string', demandOption: true, alias: 'clientId' }),
      rotateSecret
    )
    .command(
      'clients:enable',
      'Enable a client',
      (y) => y.option('client-id', { type: 'string', demandOption: true, alias: 'clientId' }),
      (argv) => setEnabled(argv, true)
    )
    .command(
      'clients:disable',
      'Disable a client',
      (y) => y.option('client-id', { type: 'string', demandOption: true, alias: 'clientId' }),
      (argv) => setEnabled(argv, false)
    )
    .command(
      'clients:add-redirect-uri',
      'Add a redirect URI',
      (y) =>
        y
          .option('client-id', { type: 'string', demandOption: true, alias: 'clientId' })
          .option('redirect-uri', { type: 'string', demandOption: true, alias: 'redirectUri' }),
      (argv) => addToArrayField(argv, 'redirect_uris', String(argv.redirectUri))
    )
    .command(
      'clients:remove-redirect-uri',
      'Remove a redirect URI',
      (y) =>
        y
          .option('client-id', { type: 'string', demandOption: true, alias: 'clientId' })
          .option('redirect-uri', { type: 'string', demandOption: true, alias: 'redirectUri' }),
      (argv) => removeFromArrayField(argv, 'redirect_uris', String(argv.redirectUri))
    )
    .command(
      'clients:add-allowed-origin',
      'Add an allowed origin',
      (y) =>
        y
          .option('client-id', { type: 'string', demandOption: true, alias: 'clientId' })
          .option('allowed-origin', { type: 'string', demandOption: true, alias: 'allowedOrigin' }),
      (argv) => addToArrayField(argv, 'allowed_origins', String(argv.allowedOrigin))
    )
    .command(
      'clients:remove-allowed-origin',
      'Remove an allowed origin',
      (y) =>
        y
          .option('client-id', { type: 'string', demandOption: true, alias: 'clientId' })
          .option('allowed-origin', { type: 'string', demandOption: true, alias: 'allowedOrigin' }),
      (argv) => removeFromArrayField(argv, 'allowed_origins', String(argv.allowedOrigin))
    )
    .demandCommand(1)
    .strict()
    .parse();
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
