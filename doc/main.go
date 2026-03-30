package main

import (
	"log"
	"os"

	"latch/internal/app"
)

func main() {
	cfg := app.Config{
		Addr:        getEnv("ADDR", ":8080"),
		PostgresDSN: getEnv("POSTGRES_DSN", "postgres://latch:latch123@localhost:5432/latch?sslmode=disable"),
		RedisAddr:   getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPrefix: getEnv("REDIS_PREFIX", "latch"),
	}

	server, err := app.NewServer(cfg)
	if err != nil {
		log.Fatalf("init server: %v", err)
	}
	defer server.Close()

	log.Printf("listening on %s", cfg.Addr)
	if err := server.Run(); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
