# Authentication Notes

This module provides a browser-first authentication flow built on a
short-lived access cookie + long-lived refresh cookie, backed by
PostgreSQL (user records) and Redis (session state).

The design keeps the auth model cookie-based (no client-side token
handling) while giving the API surface enough seams for future
third-party / bearer-token clients.

## Core Components

- `User`
  - fields: `id`, `username`, `email`, `password_hash`, `created_at`
  - persisted in the `users` table
- `AccessSession`
  - fields: `id` (= access token), `user_id`, `username`, `role`,
    `device_type`, `device_id`, `family_id`, `refresh_id`,
    `issued_at`, `expires_at`
  - serialized into Redis under `session:access:{tok}`
- `RefreshToken`
  - fields: `id` (= refresh token), `user_id`, `device_id`,
    `family_id`, `prev_refresh`, `revoked`, `issued_at`, `expires_at`
  - serialized into Redis under `session:refresh:{tok}`;
    `session:family:{fid}` (SET) tracks every refresh alive in the family
- Cookies
  - `access_token` — `HttpOnly; Secure; SameSite=Lax; Path=/`,
    Max-Age = 30 min
  - `refresh_token` — `HttpOnly; Secure; SameSite=Strict;
    Path=/api/token`, Max-Age = 30 天

The retired single `session_id` cookie (and its 24h Redis TTL) is gone;
existing sessions from that era are not migrated — they get a one-shot
401 and the UI drops the user back on the login page.

## Storage Design

### PostgreSQL

PostgreSQL remains the system of record for:

- user accounts
- Markdown metadata
- Passkey credentials
- login history
- invitation codes

### Redis

Redis handles the request-path auth state:

- access-token lookup on every authenticated API call
- refresh-token rotation on `POST /api/token/refresh`
- family tracking for replay detection and multi-device logout
- automatic expiration via TTL — no cron, no cleanup job

## Authentication Flow

Auth uses a two-token model: a short-lived access token on every API
call and a long-lived refresh token consumed only by the token-refresh
endpoint. See [auth-refresh.md](./auth-refresh.md) for TTLs, cookie
attributes, Redis key shapes, family rotation, and replay detection.

### Register: `POST /api/register`

- validate `username`, `email`, `password`
- when site setting `registration_requires_invite=true`, require `invitation_code`
  - tentatively consume the invite code with a pending marker before creating the user
  - release the code if later steps (email check, hashing, user creation) fail
  - bind the code to the new `user_id` after the user row is created
- ensure email uniqueness
- hash the password with `bcrypt`
- create user in PostgreSQL
- issue a new token family: access + refresh
- write `access_token` and `refresh_token` cookies

### Login: `POST /api/login`

- validate `email`, `password`
- verify password hash
- issue a new token family: access + refresh
- write `access_token` and `refresh_token` cookies

### Refresh: `POST /api/token/refresh`

- read the `refresh_token` cookie (or `Authorization: Bearer`)
- revoke the presented refresh token; if it was already revoked, collapse the whole family
- issue a fresh access + refresh pair within the same family
- write both cookies back

### Logout: `POST /api/logout`

- delete the access token from Redis
- revoke every refresh token in the family
- clear both cookies

### Current User: `GET /api/me`

- require valid authenticated session
- return current user identity

## Middleware

### AuthMiddleware

- read the access token via `Authorization: Bearer <tok>` header first,
  then fall back to the `access_token` cookie
- load `session:access:{tok}` from Redis
- on miss / expired: clear **both** auth cookies on the response (so
  the browser doesn't keep resending a dead access cookie), then
  respond 401 for API requests or redirect to `/login` for pages
- on hit: inject `user_id`, `username`, `role`, `session` into the Gin
  context

### GuestMiddleware

- check whether a valid access session already exists
- redirect authenticated users away from guest-only pages such as login and register

## Cookie 保活机制 / Keep-alive

"Keep-alive" here is a two-layer contract between server and browser.
Neither side is allowed to sliding-extend the access cookie on every
request — that would defeat the short-TTL threat model. Instead the
access cookie is deliberately disposable and the refresh cookie is the
thing that survives.

### Server side

1. **Access cookie is short and fixed**. TTL = `AccessTokenTTL` (30 min,
   `internal/app/dock/config.go`). No sliding renewal on read; the
   token rides out its TTL and dies. This bounds replay exposure if a
   token leaks through logs, XSS, or a proxy.
2. **Refresh cookie is long-lived but rotates**. TTL =
   `RefreshTokenTTL` (30 天). On every `POST /api/token/refresh` the
   presented refresh token is revoked, a new refresh is issued under
   the same `family_id`, and both cookies are rewritten. `prev_refresh`
   is recorded so family walks can trace ancestry.
3. **Replay collapses the family**. If `rotateRefreshToken` sees
   `revoked: true` on the presented refresh, `ErrRefreshReplay` fires
   and `revokeFamily(family_id)` nukes every refresh token in the set
   plus the family SET itself. Every device on that family needs to
   re-login. This is what makes long-TTL refresh cookies safe to ship.
4. **Stale-cookie cleanup**. When `AuthMiddleware` can't find the
   access session in Redis, it calls `clearAuthCookies(c)` so the
   browser stops sending the dead cookie on subsequent requests. Pages
   redirect to `/login`; API calls return 401.
5. **Path scoping**. The refresh cookie is `Path=/api/token` so it's
   only attached to refresh requests — normal API traffic never
   carries it. `SameSite=Strict` on refresh blocks cross-site refresh
   attempts entirely.
6. **Device binding (optional)**. `rotateRefreshToken` checks the
   request device against the bound `device_id` on the refresh record
   when set; a mismatch revokes the family.

### Browser side

`ui/src/api/http.ts` installs a single global `window.fetch` wrapper
at module import time (any page that imports from `./api/*` gets it
automatically; login/register/index pages don't import it and keep
plain `fetch`).

Behaviour:

1. Every API call goes through the wrapper. If the response is not 401,
   it passes through unchanged.
2. On 401, the wrapper skips the retry for auth-boundary paths
   (`/api/login`, `/api/register`, `/api/logout`, `/api/token/refresh`)
   so those endpoints can 401 normally without looping.
3. Otherwise it calls `POST /api/token/refresh` exactly once, gated by
   a module-level `refreshInFlight` promise: concurrent 401s from
   parallel requests all await the same refresh, they don't each fire
   a refresh of their own. The lock is released on `queueMicrotask` so
   every waiter sees the result before a fresh refresh can start.
4. If refresh succeeds, the original request is retried once with the
   newly-issued access cookie. Non-retryable bodies (already-consumed
   streams) surface as a `TypeError`, handled like any network error.
5. If refresh itself 401s, the wrapper returns the original 401 and the
   caller (or the page's top-level bootstrap) routes to `/login.html`.

The mutex matters: without it, ten concurrent 401s would each fire a
refresh, the first would succeed, and the rest would present the
already-revoked refresh cookie — which would trip family-replay and
kick the user out on a perfectly normal page load.

### What is **not** a keep-alive mechanism

- There is no server-side sliding renewal on `GET /api/me` or any other
  read. The access token TTL is authoritative.
- There is no heartbeat / ping endpoint that extends the cookie while
  the user is on the page. Activity alone doesn't keep the session
  alive; the 401→refresh→retry round-trip does.
- JWT is not used. Revocation is an atomic Redis `DEL`; no blocklist
  needed. A verify-without-roundtrip JWT track can be added later for
  third-party API clients without touching the web flow.

## Session Lifecycle

- access sessions expire in Redis via `AccessTokenTTL` (30 min)
- refresh tokens expire in Redis via `RefreshTokenTTL` (30 天); every
  rotation resets the TTL on the family SET too
- logout explicitly deletes the access token and walks the family set
- no database cleanup job is needed

## Runtime Configuration

- `POSTGRES_DSN` — PostgreSQL connection string
- `REDIS_ADDR` — Redis address, for example `localhost:6379`
- `REDIS_PASSWORD` — Redis password, if needed
- `REDIS_DB` — Redis logical database index
- `REDIS_PREFIX` — prefix used for session keys (defaults to `polar`)

## Redis Key Patterns

Session state lives under three keyspaces, all prefixed by
`REDIS_PREFIX` (default `polar`):

```text
<prefix>:session:access:<access_token>      STRING, TTL = AccessTokenTTL
<prefix>:session:refresh:<refresh_token>    STRING, TTL = RefreshTokenTTL
<prefix>:session:family:<family_id>         SET,    TTL = RefreshTokenTTL
```

`session:family:<fid>` members are the refresh-token strings currently
alive in the family; it's what `revokeFamily` walks on replay detection
and what logout iterates on.

## Notes

- This module uses server-side opaque sessions rather than JWT. The
  choice is intentional for a browser-first experience project and
  makes revocation cheap.
- Passkey authentication builds on the same Redis-backed session layer
  after verification succeeds — the WebAuthn begin/finish flow uses a
  separate short-lived `passkey_*` Redis record (scoped by
  `X-Passkey-Session` header), not the auth cookie.
