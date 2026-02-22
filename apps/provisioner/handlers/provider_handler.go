package handlers

import (
	"context"

	"github.com/dokploy/provisioner/db"
	"github.com/dokploy/provisioner/encrypt"
	"github.com/dokploy/provisioner/providers"
	"github.com/gofiber/fiber/v2"
)

type ProviderHandlers struct {
	db     *db.DB
	encKey string
}

func NewProviderHandlers(database *db.DB, encKey string) *ProviderHandlers {
	return &ProviderHandlers{db: database, encKey: encKey}
}

// TestConnection validates the provider API token.
func (h *ProviderHandlers) TestConnection(c *fiber.Ctx) error {
	providerID := c.Params("providerId")

	var row struct {
		EncryptedAPIToken string
		ProviderType      string
	}
	err := h.db.Pool.QueryRow(context.Background(),
		`SELECT "encryptedApiToken", "providerType" FROM "cloud_provider" WHERE "cloudProviderId" = $1`,
		providerID,
	).Scan(&row.EncryptedAPIToken, &row.ProviderType)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "provider not found"})
	}

	token, err := encrypt.Decrypt(row.EncryptedAPIToken, h.encKey)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to decrypt token"})
	}

	if err := providers.TestToken(row.ProviderType, token); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error(), "valid": false})
	}

	return c.JSON(fiber.Map{"valid": true})
}

// ListRegions returns available regions for a provider.
func (h *ProviderHandlers) ListRegions(c *fiber.Ctx) error {
	providerID := c.Params("providerId")

	var row struct {
		EncryptedAPIToken string
		ProviderType      string
	}
	err := h.db.Pool.QueryRow(context.Background(),
		`SELECT "encryptedApiToken", "providerType" FROM "cloud_provider" WHERE "cloudProviderId" = $1`,
		providerID,
	).Scan(&row.EncryptedAPIToken, &row.ProviderType)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "provider not found"})
	}

	token, err := encrypt.Decrypt(row.EncryptedAPIToken, h.encKey)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to decrypt token"})
	}

	regions, err := providers.ListRegions(row.ProviderType, token)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(regions)
}

// ListSizes returns available server sizes for a provider and region.
func (h *ProviderHandlers) ListSizes(c *fiber.Ctx) error {
	providerID := c.Params("providerId")
	region := c.Query("region", "")

	var row struct {
		EncryptedAPIToken string
		ProviderType      string
	}
	err := h.db.Pool.QueryRow(context.Background(),
		`SELECT "encryptedApiToken", "providerType" FROM "cloud_provider" WHERE "cloudProviderId" = $1`,
		providerID,
	).Scan(&row.EncryptedAPIToken, &row.ProviderType)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "provider not found"})
	}

	token, err := encrypt.Decrypt(row.EncryptedAPIToken, h.encKey)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to decrypt token"})
	}

	sizes, err := providers.ListServerSizes(row.ProviderType, token, region)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(sizes)
}

// EncryptToken encrypts an API token using the provisioner key.
// Called by Node.js when creating a new cloud provider.
func (h *ProviderHandlers) EncryptToken(c *fiber.Ctx) error {
	var body struct {
		Token string `json:"token"`
	}
	if err := c.BodyParser(&body); err != nil || body.Token == "" {
		return c.Status(400).JSON(fiber.Map{"error": "token is required"})
	}
	enc, err := encrypt.Encrypt(body.Token, h.encKey)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "encryption failed"})
	}
	return c.JSON(fiber.Map{"encryptedToken": enc})
}
