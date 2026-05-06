package main

import (
	"log"
	"os"
	"strconv"

	"gin-auth-app/internal/app/dock"
)

func main() {
	redisDB := dock.DefaultRedisDB
	if value := os.Getenv("REDIS_DB"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			log.Fatalf("invalid REDIS_DB: %v", err)
		}
		redisDB = parsed
	}

	smtpPort := 587
	if value := os.Getenv("SMTP_PORT"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			log.Fatalf("invalid SMTP_PORT: %v", err)
		}
		smtpPort = parsed
	}

	// Video studio: poll cadence for in-flight Seedance jobs. 10s matches
	// the bash `poll_results.sh` POLL_INTERVAL=15 with a slight tighten.
	videoPollInterval := 10
	if value := os.Getenv("VIDEO_POLL_INTERVAL"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed <= 0 {
			log.Fatalf("invalid VIDEO_POLL_INTERVAL: %v", err)
		}
		videoPollInterval = parsed
	}

	cfg := dock.Config{
		Addr:                envOrDefault("ADDR", dock.DefaultAddr),
		PostgresDSN:         envOrDefault("POSTGRES_DSN", dock.DefaultPostgresDSN),
		RedisAddr:           envOrDefault("REDIS_ADDR", dock.DefaultRedisAddr),
		RedisPassword:       os.Getenv("REDIS_PASSWORD"),
		RedisDB:             redisDB,
		RedisPrefix:         envOrDefault("REDIS_PREFIX", dock.DefaultRedisPrefix),
		MarkdownDir:         envOrDefault("MARKDOWN_DIR", dock.DefaultMarkdownDir),
		UploadDir:           envOrDefault("UPLOAD_DIR", dock.DefaultUploadDir),
		GeoLiteDBPath:       envOrDefault("GEOLITE_DB_PATH", dock.DefaultGeoLiteDBPath),
		PasskeyRPID:         envOrDefault("PASSKEY_RP_ID", dock.DefaultPasskeyRPID),
		PasskeyOrigin:       envOrDefault("PASSKEY_ORIGIN", dock.DefaultPasskeyOrigin),
		PasskeyRPName:       envOrDefault("PASSKEY_RP_NAME", dock.DefaultPasskeyRPName),
		PublicBaseURL:       envOrDefault("PUBLIC_BASE_URL", envOrDefault("PASSKEY_ORIGIN", dock.DefaultPasskeyOrigin)),
		AIAgentAPIKey:       os.Getenv("AI_AGENT_API_KEY"),
		AIAgentBaseURL:      envOrDefault("AI_AGENT_BASE_URL", "https://api.openai.com/v1/chat/completions"),
		AIAgentModel:        envOrDefault("AI_AGENT_MODEL", "gpt-4.1-mini"),
		AIAgentSystemPrompt: envOrDefault("AI_AGENT_SYSTEM_PROMPT", "你是站内 system 助理。请结合项目运行目录中的文档和用户提问，给出简洁、准确、可执行的中文回答。如果资料不足，请明确说明。"),
		AIAgentStreaming:    envBoolDefault("AI_AGENT_STREAMING", true),
		ApplePushTopic:      os.Getenv("APPLE_PUSH_TOPIC"),
		ApplePushTopicDev:   os.Getenv("APPLE_PUSH_TOPIC_DEV"),
		ApplePushTopicProd:  os.Getenv("APPLE_PUSH_TOPIC_PROD"),
		ApplePushKeyID:      os.Getenv("APPLE_PUSH_KEY_ID"),
		ApplePushKeyIDDev:   os.Getenv("APPLE_PUSH_KEY_ID_DEV"),
		ApplePushKeyIDProd:  os.Getenv("APPLE_PUSH_KEY_ID_PROD"),
		ApplePushTeamID:     os.Getenv("APPLE_PUSH_TEAM_ID"),
		ApplePushTeamIDDev:  os.Getenv("APPLE_PUSH_TEAM_ID_DEV"),
		ApplePushTeamIDProd: os.Getenv("APPLE_PUSH_TEAM_ID_PROD"),
		SMTPHost:            os.Getenv("SMTP_HOST"),
		SMTPPort:            smtpPort,
		SMTPUsername:        os.Getenv("SMTP_USERNAME"),
		SMTPPassword:        os.Getenv("SMTP_PASSWORD"),
		SMTPFromEmail:       os.Getenv("SMTP_FROM_EMAIL"),
		SMTPFromName:        os.Getenv("SMTP_FROM_NAME"),

		// Cloudflare R2 — chat attachment storage (optional)
		CloudflareR2AccountID:       os.Getenv("CF_R2_ACCOUNT_ID"),
		CloudflareR2AccessKeyID:     os.Getenv("CF_R2_ACCESS_KEY_ID"),
		CloudflareR2SecretAccessKey: os.Getenv("CF_R2_SECRET_ACCESS_KEY"),
		CloudflareR2Bucket:          os.Getenv("CF_R2_BUCKET"),
		CloudflareR2PublicURL:       os.Getenv("CF_R2_PUBLIC_URL"),

		// Video studio
		VideoPollIntervalSeconds: videoPollInterval,
		VideoSeedanceBaseURL:     envOrDefault("VIDEO_SEEDANCE_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
		VideoSeedanceModel:       envOrDefault("VIDEO_SEEDANCE_MODEL", "doubao-seedance-1-0-pro-250528"),
		VideoSeedanceAPIKey:      os.Getenv("VIDEO_SEEDANCE_API_KEY"),

		// iOS distribution
		IOSDistResourceKey: os.Getenv("IOSDIST_RESOURCE_KEY"),
	}

	server, err := dock.NewServer(cfg)
	if err != nil {
		log.Fatalf("init server: %v", err)
	}
	defer func() {
		if err := server.Close(); err != nil {
			log.Printf("close db: %v", err)
		}
	}()

	if err := server.Run(); err != nil {
		log.Fatalf("run server: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envBoolDefault(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		log.Printf("invalid %s=%q, falling back to %v", key, value, fallback)
		return fallback
	}
	return parsed
}
