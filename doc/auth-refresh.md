# Auth: Access + Refresh Tokens

## Motivation

The previous auth model was a single opaque `session_id` cookie with a 24h
Redis TTL. That forced every user to re-authenticate once a day, and it
gave us no surface for a future open-platform / third-party-client story
(bearer tokens, OAuth flows, per-client revocation).

We move to a two-token model: a **short-lived access token** that's
presented on every API call, and a **long-lived refresh token** that
only exists to mint new access tokens. Refresh tokens rotate on every
use, with family-based replay detection.

## Token types

| Type | TTL | Cookie | Redis key | Used by |
| --- | --- | --- | --- | --- |
| access | 30 minutes | `access_token` — `HttpOnly; Secure; SameSite=Lax; Path=/` | `session:access:{tok}` | every authenticated API request |
| refresh | 30 days | `refresh_token` — `HttpOnly; Secure; SameSite=Strict; Path=/api/token` | `session:refresh:{tok}` | `POST /api/token/refresh` only |

Cookie names are explicit (`access_token`, `refresh_token`); the old
`session_id` cookie name is retired.

### Redis value shape

```
session:access:{tok}  → {
  user_id, username, device_type, device_id,
  family_id, scopes,
  issued_at, expires_at
}
session:refresh:{tok} → {
  user_id, device_id,
  family_id, prev_refresh,
  issued_at, expires_at,
  revoked: bool
}
session:family:{fid}  → set of refresh tokens currently alive in this family
```

`scopes` is reserved for future use and defaults to `["*"]` for the
first-party web client. When we stand up an OAuth authorization page,
scopes will get narrowed at issuance time; middleware will then gate
endpoints on required scope.

## Endpoints

### `POST /api/login`, `POST /api/register`

On success, issue a **new family** (random `family_id`) and a fresh
access + refresh pair. Both cookies are set on the response.

### `POST /api/token/refresh`

1. Read the `refresh_token` cookie (or `Authorization: Bearer <tok>` when
   we add third-party API client support).
2. Look up `session:refresh:{tok}`. If missing or expired → 401.
3. **Replay detection**: if the record has `revoked: true`, treat this
   as a potential theft event. Walk `session:family:{fid}` and revoke
   every refresh token in the family. The user will be logged out
   everywhere on next request. Return 401.
4. **Device binding**: compare the stored `device_id` with the current
   request's device. Mismatch → revoke family, return 401.
5. Mark the current refresh token `revoked: true` and remove it from
   the family set.
6. Generate a new access token and a new refresh token. Both carry the
   same `family_id`. The new refresh gets `prev_refresh = {tok}`.
7. Write both cookies back. Return `{ok: true}`.

Refresh rotation means a leaked cookie is only useful once; the second
use (either by attacker or victim) collapses the family and forces
re-login.

### `POST /api/logout`

1. Delete the access token from Redis.
2. Delete all refresh tokens in `session:family:{fid}` and the family
   set itself.
3. Clear both cookies on the response (`Max-Age=-1`).

### `GET /api/me` and all other authenticated endpoints

`AuthMiddleware` looks for auth in this order:

1. `Authorization: Bearer <tok>` header — for future third-party clients
   and SDK users.
2. `access_token` cookie — for the first-party web UI.

Found token is looked up in `session:access:{tok}`. On success, inject
`user_id`, `username`, `device_id`, `scopes` into the Gin context. Miss
or expired → 401 with `auth.unauthorized`.

## Client flow

### First-party web

`ui/src/api/http.ts` gains a 401 interceptor:

1. When any authenticated fetch returns 401, the interceptor serializes
   through a module-level mutex: only one refresh request can be in
   flight at a time.
2. It calls `POST /api/token/refresh`. On success, it retries the
   original request once.
3. If `/refresh` itself returns 401, the interceptor clears local state
   and redirects to `/login.html`.

The mutex is critical: without it, ten concurrent 401s would all trigger
ten refresh calls, and only the first would succeed (subsequent refresh
calls present the already-revoked token and trip family revocation,
logging the user out).

### Future third-party clients (design seam, not implemented yet)

- Tokens travel in `Authorization: Bearer <tok>` header.
- `/api/token/refresh` accepts `refresh_token` via either cookie or
  request body (`{refresh_token: "..."}`) so non-browser clients can
  store it in a keychain.
- `scopes` on the access token record narrows what endpoints that
  client can hit.
- When we add an OAuth authorization page, it will create a refresh
  token with the requested scopes and return it along with the access
  token.

## Security properties

- **Short access TTL (30 min)** limits replay window if a token leaks
  through logs, XSS, or a compromised relying party.
- **Refresh token path scoping** (`Path=/api/token`) means the refresh
  cookie isn't sent on normal API calls, reducing its exposure surface.
- **SameSite=Strict on refresh** blocks cross-site refresh attempts.
- **Family rotation** detects clones: two clients can't both use the
  same refresh token long enough to matter.
- **Device binding** raises the cost of cookie theft — a stolen cookie
  is only useful from a request that also looks like the original
  device.
- **Opaque, not JWT**: revocation is an atomic Redis delete; we don't
  need a separate blocklist. JWT can be introduced later as a second
  track for third-party API clients that want verify-without-roundtrip.

## Migration

Single-cut replacement. On deploy:

- Old `session_id` cookies stop validating; users get 401 once, UI
  interceptor tries refresh, refresh fails (no refresh cookie exists),
  UI redirects to `/login.html`.
- Users log in again, now on the new scheme. No data-layer migration.

This is acceptable because the previous TTL was already 24h — the churn
window is narrow, and the worst case is "some users re-log after the
deploy".

## Non-goals

- JWT / signed self-describing tokens (can be added later for public
  API without changing the web flow).
- Multi-device session management UI (listing and revoking sessions
  per device). The data model supports it; the UI work is deferred.
- Per-scope rate limiting. Also deferred.
