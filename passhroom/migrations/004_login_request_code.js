exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('login_requests', {
    code_hash: { type: 'text', notNull: false }
  });

  // Helps code lookups without scanning the whole table.
  pgm.createIndex('login_requests', ['code_hash']);
};

exports.down = (pgm) => {
  pgm.dropIndex('login_requests', ['code_hash']);
  pgm.dropColumn('login_requests', 'code_hash');
};
