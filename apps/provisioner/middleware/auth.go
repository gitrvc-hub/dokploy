package middleware

import "github.com/gofiber/fiber/v2"

// APIKeyAuth returns a Fiber middleware that validates the X-API-Key header.
func APIKeyAuth(expectedKey string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if c.Path() == "/health" {
			return c.Next()
		}
		key := c.Get("X-API-Key")
		if key != expectedKey {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}
		return c.Next()
	}
}
