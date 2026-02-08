exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email_normalized: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('clients', {
    client_id: { type: 'text', primaryKey: true },
    client_secret_hash: { type: 'text', notNull: true },
    redirect_uris: { type: 'jsonb', notNull: true, default: '[]' },
    allowed_origins: { type: 'jsonb', notNull: true, default: '[]' },
    is_enabled: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createIndex('clients', 'client_id', { unique: true });

  pgm.createTable('login_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    client_id: { type: 'text', notNull: true, references: 'clients(client_id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    redirect_uri: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true },
    app_return_to: { type: 'text', notNull: false },
    magic_token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz', notNull: false },
    attempts: { type: 'integer', notNull: true, default: 0 },
    ip: { type: 'text', notNull: true },
    user_agent: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('login_requests', ['client_id', 'user_id', 'created_at']);
  pgm.createIndex('login_requests', ['magic_token_hash'], { unique: true });
  pgm.createIndex('login_requests', ['expires_at']);

  pgm.createTable('auth_codes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    client_id: { type: 'text', notNull: true, references: 'clients(client_id)', onDelete: 'CASCADE' },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    redirect_uri: { type: 'text', notNull: true },
    code_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('auth_codes', ['client_id', 'redirect_uri', 'code_hash'], { unique: true });
  pgm.createIndex('auth_codes', ['expires_at']);

  pgm.createTable('rate_limits', {
    scope: { type: 'text', notNull: true },
    scope_id: { type: 'text', notNull: true },
    window_seconds: { type: 'integer', notNull: true },
    count: { type: 'integer', notNull: true },
    reset_at: { type: 'timestamptz', notNull: true }
  });
  pgm.addConstraint('rate_limits', 'rate_limits_pk', {
    primaryKey: ['scope', 'scope_id', 'window_seconds']
  });
  pgm.createIndex('rate_limits', ['reset_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('rate_limits');
  pgm.dropTable('auth_codes');
  pgm.dropTable('login_requests');
  pgm.dropTable('clients');
  pgm.dropTable('users');
};
