# Future Work

Based on the current source at the time of writing. Organized by theme — security first, then product, then polish.

---

## Security & Correctness

### Rate Limiting on Auth Endpoints
`/api/login`, `/api/register`, and `/api/passkey/login/begin` have no rate limiting. A trivial script can enumerate passwords or flood the WebAuthn ceremony. Add a per-IP sliding-window middleware (e.g. `golang.org/x/time/rate` or a Redis token-bucket) before these handlers.

### Pagination Limit Cap
Every list endpoint accepts `limit` from the caller and passes it directly to the query. There is no upper-bound check. A single request with `limit=1000000` can read the full table. Add a hard cap (`if limit > 200 { limit = 200 }`) in every handler that reads this parameter.

### Chat Access Control
Chat message endpoints fetch messages from a thread ID supplied by the client. The handler should verify the requesting user is a participant of that thread before returning data. The schema has `chat_threads.participant1_id / participant2_id` — this check is cheap and must be done.

### Email Verification Token Expiry
`email_verification_tokens` are stored without a visible TTL or expiry enforcement. A leaked token is valid indefinitely. Add a `created_at` column and reject tokens older than 24 hours.

### Post Visibility Enforcement
Every `Post` row has `is_public`, but the list endpoints appear to return all rows regardless. Feed and profile endpoints should filter `WHERE is_public = TRUE` for unauthenticated callers and honor user-block relationships for authenticated ones.

### WebSocket Origin Check
`CheckOrigin` is set to `func(r *http.Request) bool { return true }`. This accepts WebSocket upgrades from any origin. In production tighten this to the known deployment domain.

### CORS Policy
Gin's default CORS allows all origins. Restrict to the expected frontend origin(s) in the CORS middleware configuration.

### Admin Password Reset Without Confirmation
An admin can reset any user's password immediately. Add an audit log row and, optionally, a confirmation step so the action is traceable.

---

## Reliability & Performance

### Database Index Audit
Several heavily-queried join patterns (messages by thread, entries by user, login records by user) rely on foreign key columns. Verify covering indexes exist for `chat_messages(thread_id, created_at)`, `markdown_entries(user_id, updated_at)`, and `login_records(user_id, logged_in_at)`. Offset-based pagination is already in use; consider keyset pagination for large tables.

### Geolocation Call on Every Login
`GeoLite2` lookup runs synchronously during the login handler. Move it to a goroutine that writes the record after the session is already issued so login latency is unaffected even on slow lookups.

### AI Agent Task Queue Depth
The LLM task queue is a buffered channel of 64 items. Under load new messages silently drop if the queue is full. Either increase the buffer, shed load with an explicit error response to the client, or replace with a persistent job table.

### Site Settings & LLM Config Caching
`/api/site-settings` and `/api/llm-configs` are fetched on every page load from every client. These change rarely. Add a short in-memory TTL cache (or Redis key with a 30-second TTL) to reduce DB round-trips.

### File Garbage Collection
Attachments uploaded to Cloudflare R2 (or local `uploads/`) are never deleted if the parent message is revoked or a chat thread is removed. Add a periodic cleanup job that cross-references stored file paths with live `chat_messages.attachment` records.

---

## Missing UI Pages & Feature Parity

### Login History Page
The backend exposes `GET /api/admin/users/:id/login-history` and `/api/login-history` for the current user. The admin panel shows this inline per-selected-user, but there is no standalone page where a regular user can review their own full login history with filtering by date or device.

### Task System UI
The backend has complete routes for task creation, applications, candidate selection, and result submission. No frontend pages expose this workflow. Either build a `tasks.html` page or integrate task management into the Posts feed for posts that have `task` metadata.

### Profile Recommendations
`POST /api/users/:id/recommendations` stores a recommendation, but there is no algorithm, ranking, or display. Decide whether this is a social-proof badge (show count + recent recommenders on the profile page) or remove the endpoint to reduce dead surface area.

### Push Notification Delivery
Device tokens are stored, APNs certificates can be uploaded, and the data model is complete. The actual `apns2` send call is not wired to any event. Connect the token delivery to at least one trigger: new chat message when the recipient is offline.

---

## Developer Experience & Maintainability

### Inconsistent API Error Shapes
Some handlers return `{"error": "..."}`, others return `{"message": "..."}` or custom field names. Define a single envelope type in `response.go` and use it everywhere. This makes frontend error handling simpler and predictable.

### Centralize Constants
Several values are duplicated across files:
- Session duration (`24 * time.Hour`) — define once in `config.go`
- Default Markdown directory (`"data/markdown"`) — read from config, not hardcoded
- Video attachment limit (`100 << 20`) — one constant used in all upload handlers
- LLM task queue depth (`64`) — one constant in the agent package

### API Versioning
All routes live at `/api/...` with no version prefix. Adding `/api/v1/` now, before any external consumers exist, avoids a forced migration later.

### OpenAPI Specification
There is no machine-readable API description. Add a `docs/openapi.yaml` (or generate one from annotations) so that clients, tests, and future contributors have a reliable contract. Swagger UI can be served at `/api/docs` during development.

### Backend i18n Completeness
Several Go handler error strings are Chinese-only or English-only with no translation lookup. Run a grep for hardcoded string literals in handlers and route them through the existing `i18n.go` catalog.

### Frontend i18n Key Coverage
The `i18n.ts` catalog has 500+ keys but a few pages (notably `latch.html` labels and some dynamic status strings in `dashboard.ts`) still contain hardcoded English or Chinese strings. A build-time check that all `t("...")` calls have corresponding catalog entries would catch regressions.

---

## Product Enhancements

### Markdown Search
`/api/markdown` returns entries ordered by `updated_at` with no search parameter. Add a `q` query parameter that does a `ILIKE` match on `title` and proxies a simple content grep on disk. Full-text search with `pg_trgm` is a natural upgrade path once entry volume grows.

### Suspicious Login Alerts
Login records already capture IP and geolocation. Compare each new login's country against the last N successful logins for the same user. If the country changes, send an email alert (the SMTP infrastructure is already in place) and surface a warning in the user's login history view.

### Passkey Device Naming
Passkey credentials are stored with a raw `credential_id`. Allow users to set a display name (e.g. "MacBook Touch ID", "iPhone Face ID") so the credential list in Settings is readable and users know which key to revoke.

### Markdown Versioning
Entries are stored as single files. Add an opt-in version history by keeping prior content snapshots under a `versions/` subdirectory. Expose a diff view in the editor so authors can see what changed between saves.

### Chat Message Search
Full-text search within a chat thread is a common expectation. A `tsvector` column on `chat_messages.content` with a GIN index would support this without a separate search service.

### Bot Usage Statistics
Each time the AI agent responds, record the token count and latency in a lightweight table. Expose aggregate usage per LLM config on the Bots page so operators can track spend and identify slow configs.

---

## Infrastructure

### Structured Logging
Log output is unstructured. Replace `log.Println` calls with a structured logger (`slog` from stdlib or `zerolog`) emitting JSON lines. This makes log aggregation (Datadog, Loki, etc.) and filtering in production practical.

### Health & Readiness Endpoints
Add `GET /healthz` (liveness) and `GET /readyz` (readiness — checks DB ping + Redis ping) for container orchestration probes.

### Configuration Validation on Startup
The app starts silently with missing environment variables and fails at runtime. Add a startup check that reads all required env vars and exits with a clear error listing every missing variable before binding the HTTP server.

### Graceful Shutdown
Ensure the HTTP server and WebSocket hub drain cleanly on `SIGTERM` (use `http.Server.Shutdown` with a deadline and close the hub's broadcast channel). This matters for zero-downtime deployments.

### Attachment Storage Abstraction Test
The `StorageBackend` interface wraps local FS and R2, but there are no integration tests covering the R2 path. Add a test against a local MinIO instance to verify upload, URL generation, and delete work correctly before deploying to a new environment.
