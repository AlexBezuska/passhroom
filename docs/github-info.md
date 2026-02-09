# Passhroom

**Description (<= 350 chars)**

Passwordless auth service for apps: start sign-in with an email, then finish via magic link. Redirects back with `code` + `state` and exchanges at `/v1/auth/token`. Built with Fastify + Postgres; deploy via Docker + Nginx templates.
