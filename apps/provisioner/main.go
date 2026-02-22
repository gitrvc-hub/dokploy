package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/dokploy/provisioner/config"
	"github.com/dokploy/provisioner/db"
	"github.com/dokploy/provisioner/handlers"
	"github.com/dokploy/provisioner/jobs"
	"github.com/dokploy/provisioner/middleware"
	"github.com/dokploy/provisioner/terraform"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()

	database, err := db.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer database.Close()
	log.Println("Connected to database")

	// Ensure terraform binary is available
	tfBinPath, err := ensureTerraform(cfg)
	if err != nil {
		log.Fatalf("failed to ensure terraform: %v", err)
	}
	log.Printf("Using terraform at %s", tfBinPath)

	// Ensure terraform workdir exists
	if err := os.MkdirAll(cfg.TerraformDir, 0755); err != nil {
		log.Fatalf("failed to create terraform workdir: %v", err)
	}

	tf := terraform.New(cfg.TerraformDir, tfBinPath)
	queue := jobs.NewQueue(database, 3)

	worker := jobs.NewWorker(database, tf, queue, cfg.EncryptionKey)
	queue.Start(3, worker.Handle)
	log.Println("Worker pool started (3 workers)")

	// HTTP server
	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024,
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, X-API-Key",
	}))

	app.Use(middleware.APIKeyAuth(cfg.APIKey))

	// Health
	app.Get("/health", handlers.HealthHandler)

	// Provider routes
	ph := handlers.NewProviderHandlers(database, cfg.EncryptionKey)
	app.Post("/providers/encrypt-token", ph.EncryptToken)
	app.Post("/providers/:providerId/test", ph.TestConnection)
	app.Get("/providers/:providerId/regions", ph.ListRegions)
	app.Get("/providers/:providerId/sizes", ph.ListSizes)

	// Server routes
	sh := handlers.NewServerHandlers(database, queue)
	app.Post("/servers/:serverId/provision", sh.Provision)
	app.Post("/servers/:serverId/install-k3s", sh.InstallK3s)
	app.Post("/servers/:serverId/byos-setup", sh.BYOSSetup)
	app.Post("/servers/:serverId/destroy", sh.Destroy)

	// Job routes
	jh := handlers.NewJobHandlers(database, queue)
	app.Get("/jobs/:jobId", jh.Status)
	app.Get("/jobs/:jobId/stream", jh.Stream)

	log.Printf("Provisioner starting on port %s", cfg.Port)
	log.Fatal(app.Listen(":" + cfg.Port))
}

func ensureTerraform(cfg *config.Config) (string, error) {
	// If terraform is in PATH, use it
	if path, err := findInPath("terraform"); err == nil {
		return path, nil
	}

	// Fall back to cached binary in terraform workdir
	binPath := filepath.Join(cfg.TerraformDir, "bin", "terraform")
	if _, err := os.Stat(binPath); err == nil {
		return binPath, nil
	}

	// No terraform found
	return "", nil // non-fatal: let it fail at runtime with a clear error
}

func findInPath(name string) (string, error) {
	// Simple PATH search
	pathEnv := os.Getenv("PATH")
	if pathEnv == "" {
		pathEnv = "/usr/local/bin:/usr/bin:/bin"
	}
	for _, dir := range filepath.SplitList(pathEnv) {
		full := filepath.Join(dir, name)
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			return full, nil
		}
	}
	return "", os.ErrNotExist
}
