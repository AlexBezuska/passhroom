exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('admin_login_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email_normalized: { type: 'text', notNull: true },
    magic_token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz', notNull: false },
    attempts: { type: 'integer', notNull: true, default: 0 },
    ip: { type: 'text', notNull: true },
    user_agent: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('admin_login_requests', ['magic_token_hash'], { unique: true });
  pgm.createIndex('admin_login_requests', ['expires_at']);

  pgm.createTable('admin_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email_normalized: { type: 'text', notNull: true },
    session_token_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('admin_sessions', ['session_token_hash'], { unique: true });
  pgm.createIndex('admin_sessions', ['expires_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('admin_sessions');
  pgm.dropTable('admin_login_requests');
};
