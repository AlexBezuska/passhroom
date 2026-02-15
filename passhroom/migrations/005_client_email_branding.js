exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('clients', {
    app_name: { type: 'text', notNull: false },
    email_subject: { type: 'text', notNull: false },
    email_button_color: { type: 'text', notNull: false },
    email_logo_png: { type: 'bytea', notNull: false }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('clients', ['email_logo_png', 'email_button_color', 'email_subject', 'app_name']);
};
