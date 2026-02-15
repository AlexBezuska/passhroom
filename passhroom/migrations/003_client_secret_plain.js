exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('clients', {
    client_secret_plain: { type: 'text', notNull: false }
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('clients', 'client_secret_plain');
};
