# Authentication Notes

This module provides a browser-oriented authentication flow based on Cookie + Session.

The current design uses:

- PostgreSQL for user persistence
- Redis for session storage and validation
- Cookie `session_id` as the browser session token

The goal of this approach is to keep the authentication model simple while improving API-side session lookup performance.

## Core Components

- `User`
  - fields: `id`, `username`, `email`, `password_hash`, `created_at`
  - persisted in the `users` table
- `Session`
  - fields: `id`, `user_id`, `username`, `expires_at`
  - serialized into Redis
- Session cookie
  - cookie name: `session_id`
  - default lifetime: 24 hours

## Storage Design

### PostgreSQL

PostgreSQL remains the system of record for:

- user accounts
- Markdown metadata
- Passkey credentials
- login history

### Redis

Redis is used for session lifecycle operations:

- session creation after login
- session lookup during authentication
- session deletion on logout
- automatic expiration through TTL

This removes session validation from the relational database hot path and makes authentication checks cheaper for API requests.

## Authentication Flow

### Register: `POST /api/register`

- validate `username`, `email`, `password`
- ensure email uniqueness
- hash the password with `bcrypt`
- create user in PostgreSQL
- create session in Redis
- write `session_id` cookie

### Login: `POST /api/login`

- validate `email`, `password`
- verify password hash
- create session in Redis
- write `session_id` cookie

### Logout: `POST /api/logout`

- delete session from Redis
- clear `session_id` cookie

### Current User: `GET /api/me`

- require valid authenticated session
- return current user identity

## Middleware

### AuthMiddleware

- read `session_id` from cookie
- load session from Redis
- reject if missing or expired
- inject `user_id`, `username`, and `session` into request context

### GuestMiddleware

- check whether a valid session already exists
- redirect authenticated users away from guest-only pages such as login and register

## Session Lifecycle

- sessions are written to Redis with TTL equal to `SessionDuration`
- expiration is handled by Redis automatically
- no database cleanup job is needed for session eviction

## Why Redis Here

Redis is a better fit than PostgreSQL for request-path session validation in this project because:

- session lookup is simple key-value access
- expiration is built in
- logout is just a key delete
- API authentication avoids repeated relational reads

For this application, that keeps the auth layer faster and operationally cleaner.

## Runtime Configuration

- `POSTGRES_DSN`
  - PostgreSQL connection string
- `REDIS_ADDR`
  - Redis address, for example `localhost:6379`
- `REDIS_PASSWORD`
  - Redis password, if needed
- `REDIS_DB`
  - Redis logical database index
- `REDIS_PREFIX`
  - prefix used for session keys

## Session Key Pattern

Session keys are stored in Redis using a prefixed format:

```text
<prefix>:session:<session_id>
```

Default prefix:

```text
polar
```

## Notes

- This module still uses server-side sessions rather than JWT.
- That choice is intentional for a browser-first experience project.
- Passkey authentication builds on the same Redis-backed session layer after verification succeeds.
