package handlers

import (
	"context"
	"fmt"

	"github.com/dokploy/provisioner/db"
	"github.com/dokploy/provisioner/jobs"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type ServerHandlers struct {
	db    *db.DB
	queue *jobs.Queue
}

func NewServerHandlers(database *db.DB, queue *jobs.Queue) *ServerHandlers {
	return &ServerHandlers{db: database, queue: queue}
}

func (h *ServerHandlers) submitJob(ctx context.Context, jobType, serverID string, payload map[string]string) (string, error) {
	jobID := fmt.Sprintf("%s-%s", serverID[:8], uuid.New().String()[:8])
	if err := h.db.CreateProvisionerJob(ctx, jobID, jobType, serverID); err != nil {
		return "", err
	}
	h.queue.Submit(&jobs.Job{
		ID:       jobID,
		Type:     jobType,
		ServerID: serverID,
		Payload:  payload,
	})
	return jobID, nil
}

// Provision starts VM provisioning for a managed (cloud) server.
func (h *ServerHandlers) Provision(c *fiber.Ctx) error {
	serverID := c.Params("serverId")
	var body struct {
		SSHPublicKey string `json:"sshPublicKey"`
	}
	_ = c.BodyParser(&body)

	jobID, err := h.submitJob(c.Context(), jobs.JobProvision, serverID, map[string]string{
		"sshPublicKey": body.SSHPublicKey,
	})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(202).JSON(fiber.Map{"jobId": jobID})
}

// InstallK3s starts K3s installation on a server.
func (h *ServerHandlers) InstallK3s(c *fiber.Ctx) error {
	serverID := c.Params("serverId")
	jobID, err := h.submitJob(c.Context(), jobs.JobInstallK3s, serverID, map[string]string{})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(202).JSON(fiber.Map{"jobId": jobID})
}

// BYOSSetup starts setup for a bring-your-own-server.
func (h *ServerHandlers) BYOSSetup(c *fiber.Ctx) error {
	serverID := c.Params("serverId")
	jobID, err := h.submitJob(c.Context(), jobs.JobBYOSSetup, serverID, map[string]string{})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(202).JSON(fiber.Map{"jobId": jobID})
}

// Destroy tears down a provisioned server.
func (h *ServerHandlers) Destroy(c *fiber.Ctx) error {
	serverID := c.Params("serverId")
	var body struct {
		SSHPublicKey string `json:"sshPublicKey"`
	}
	_ = c.BodyParser(&body)

	jobID, err := h.submitJob(c.Context(), jobs.JobDestroy, serverID, map[string]string{
		"sshPublicKey": body.SSHPublicKey,
	})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(202).JSON(fiber.Map{"jobId": jobID})
}
