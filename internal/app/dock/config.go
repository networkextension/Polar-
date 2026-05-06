package dock

import "time"

const (
	// AccessCookieName is the cookie that carries the short-lived access
	// token on every authenticated API request. See doc/auth-refresh.md.
	AccessCookieName = "access_token"
	// RefreshCookieName is the cookie that carries the long-lived refresh
	// token; it is only sent on the refresh endpoint because of the
	// narrow Path scope.
	RefreshCookieName = "refresh_token"
	// RefreshCookiePath limits where the refresh cookie is transmitted so
	// the token doesn't accompany every API call.
	RefreshCookiePath = "/api/token"
	// AccessTokenTTL controls the access cookie Max-Age and the Redis TTL
	// of the access token record. Kept short so a leaked token expires
	// quickly.
	AccessTokenTTL = 30 * time.Minute
	// RefreshTokenTTL controls the refresh cookie Max-Age and the Redis
	// TTL of the refresh token record. Refresh rotation on use means a
	// clone is detected long before this window elapses.
	RefreshTokenTTL = 30 * 24 * time.Hour

	DefaultRedisAddr     = "localhost:6379"
	DefaultRedisDB       = 0
	DefaultRedisPrefix   = "polar"
	DefaultMarkdownDir   = "data/markdown"
	DefaultUploadDir     = "data/uploads"
	DefaultGeoLiteDBPath = "data/GeoLite2-City.mmdb"
	DefaultAddr          = ":8080"
	DefaultPostgresDSN   = "postgres://ideamesh:test123456@localhost:5432/ideamesh?sslmode=disable"
	DefaultPasskeyRPID   = "localhost"
	DefaultPasskeyOrigin = "http://localhost:8080"
	DefaultPasskeyRPName = "Gin Auth Demo"
)

type Config struct {
	Addr                string
	PostgresDSN         string
	RedisAddr           string
	RedisPassword       string
	RedisDB             int
	RedisPrefix         string
	MarkdownDir         string
	UploadDir           string
	GeoLiteDBPath       string
	PasskeyRPID         string
	PasskeyOrigin       string
	PasskeyRPName       string
	AIAgentAPIKey       string
	AIAgentBaseURL      string
	AIAgentModel        string
	AIAgentSystemPrompt string
	AIAgentStreaming    bool
	ApplePushTopic      string
	ApplePushTopicDev   string
	ApplePushTopicProd  string
	ApplePushKeyID      string
	ApplePushKeyIDDev   string
	ApplePushKeyIDProd  string
	ApplePushTeamID     string
	ApplePushTeamIDDev  string
	ApplePushTeamIDProd string
	PublicBaseURL       string
	SMTPHost            string
	SMTPPort            int
	SMTPUsername        string
	SMTPPassword        string
	SMTPFromEmail       string
	SMTPFromName        string

	// Cloudflare R2 object storage for chat attachments (optional).
	// When all five fields are set, chat files are stored in R2.
	// Otherwise the server falls back to local filesystem storage.
	CloudflareR2AccountID       string // Cloudflare account ID
	CloudflareR2AccessKeyID     string // R2 access key ID
	CloudflareR2SecretAccessKey string // R2 secret access key
	CloudflareR2Bucket          string // R2 bucket name
	CloudflareR2PublicURL       string // public base URL, e.g. https://pub-xxx.r2.dev

	// Video studio. Defaults are sane for a localhost dev setup; in prod
	// these should come from env so the operator can swap providers / keys.
	VideoPollIntervalSeconds int    // poll cadence for in-flight Seedance tasks; default 10
	VideoSeedanceBaseURL     string // e.g. https://ark.cn-beijing.volces.com/api/v3
	VideoSeedanceModel       string // e.g. doubao-seedance-1-0-pro-250528
	VideoSeedanceAPIKey      string // ARK_API_KEY equivalent; seeds a system video config on first boot

	// iOS distribution: 32-byte hex AES-GCM key used to encrypt .p12
	// passwords at rest. When unset the platform stores cert passwords
	// in plaintext and flags it on the API response so the operator
	// knows to set the key before going to production.
	IOSDistResourceKey string
}
