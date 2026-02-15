# Authentication Flow

## Endpoints

- `POST /v1/auth/start`
- `POST /v1/auth/token`

## Flow Summary

1. Client app calls `/v1/auth/start` with:
   - `client_id`
   - user `email`
   - `redirect_uri`
   - app `state`
2. Passhroom validates client + redirect URI allowlist.
3. Passhroom sends a magic-link email to the user.
4. User clicks link; Passhroom verifies link validity.
5. Passhroom redirects to app callback with short-lived `code` + original `state`.
6. App backend exchanges `code` at `/v1/auth/token` using `client_id`, `client_secret`, and same `redirect_uri`.
7. Passhroom returns token payload for app session creation.

## Security Properties

- Client credentials are required for token exchange.
- Auth codes are short-lived and one-time use.
- Redirect URI must match a configured allowlist entry exactly.
- Request throttling helps reduce abuse and enumeration.
- Email deliverability controls (SPF/DKIM/DMARC) are required for production reliability.

## Recommended App Integration

- Keep `client_secret` server-side only.
- Validate returned `state` for CSRF protection.
- Handle expired/used codes gracefully and restart auth.
- Keep callback URLs stable and pre-registered in Passhroom.

## Admin Access

Admin login is also magic-link based and gated by:
- `ADMIN_ENABLED`
- optional email allowlist (`ADMIN_EMAIL_ALLOWLIST`)
- optional required header gate (`ADMIN_REQUIRE_HEADER_NAME` / `ADMIN_REQUIRE_HEADER_VALUE`)