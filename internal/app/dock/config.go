package dock

import "time"

const (
	SessionCookieName    = "session_id"
	SessionDuration      = 24 * time.Hour
	DefaultMarkdownDir   = "data/markdown"
	DefaultGeoLiteDBPath = "data/GeoLite2-City.mmdb"
	DefaultAddr          = ":8080"
	DefaultPostgresDSN   = "postgres://gin_tester:test123456@localhost:5432/gin_auth?sslmode=disable"
	DefaultPasskeyRPID   = "localhost"
	DefaultPasskeyOrigin = "http://localhost:8080"
	DefaultPasskeyRPName = "Gin Auth Demo"
)

type Config struct {
	Addr          string
	PostgresDSN   string
	MarkdownDir   string
	GeoLiteDBPath string
	PasskeyRPID   string
	PasskeyOrigin string
	PasskeyRPName string
}
