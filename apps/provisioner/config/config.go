package config

import (
	"log"
	"os"
)

type Config struct {
	Port           string
	DatabaseURL    string
	EncryptionKey  string
	APIKey         string
	TerraformDir   string
}

func Load() *Config {
	cfg := &Config{
		Port:          getEnv("PORT", "4600"),
		DatabaseURL:   getEnv("DATABASE_URL", ""),
		EncryptionKey: getEnv("PROVISIONER_ENCRYPTION_KEY", ""),
		APIKey:        getEnv("PROVISIONER_API_KEY", ""),
		TerraformDir:  getEnv("TERRAFORM_WORKDIR", "/tmp/provisioner/terraform"),
	}

	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if cfg.EncryptionKey == "" {
		log.Fatal("PROVISIONER_ENCRYPTION_KEY is required (32-byte hex string)")
	}
	if cfg.APIKey == "" {
		log.Fatal("PROVISIONER_API_KEY is required")
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
