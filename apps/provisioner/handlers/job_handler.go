package handlers

import (
	"bufio"
	"context"
	"fmt"
	"time"

	"github.com/dokploy/provisioner/db"
	"github.com/dokploy/provisioner/jobs"
	"github.com/gofiber/fiber/v2"
)

type JobHandlers struct {
	db    *db.DB
	queue *jobs.Queue
}

func NewJobHandlers(database *db.DB, queue *jobs.Queue) *JobHandlers {
	return &JobHandlers{db: database, queue: queue}
}

// Status returns the current status of a job.
func (h *JobHandlers) Status(c *fiber.Ctx) error {
	jobID := c.Params("jobId")
	status, err := h.db.GetJobStatus(context.Background(), jobID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "job not found"})
	}
	lines, _ := h.db.GetJobLogs(context.Background(), jobID)
	return c.JSON(fiber.Map{"jobId": jobID, "status": status, "lines": lines})
}

// Stream sends job log lines as Server-Sent Events.
// Existing lines are sent immediately; new lines are streamed as they arrive.
func (h *JobHandlers) Stream(c *fiber.Ctx) error {
	jobID := c.Params("jobId")

	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		// If the job has an active logger, use it for real-time streaming.
		if logger, ok := h.queue.GetLogger(jobID); ok {
			prev, ch := logger.Subscribe()
			defer logger.Unsubscribe(ch)

			// Send backlog
			for _, line := range prev {
				fmt.Fprintf(w, "data: %s\n\n", line)
			}
			w.Flush()

			// Stream new lines
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()

			for {
				select {
				case line, ok := <-ch:
					if !ok {
						fmt.Fprintf(w, "data: [DONE]\n\n")
						w.Flush()
						return
					}
					fmt.Fprintf(w, "data: %s\n\n", line)
					w.Flush()
				case <-ticker.C:
					// Heartbeat to keep connection alive
					fmt.Fprintf(w, ": heartbeat\n\n")
					w.Flush()
					// Check if job is done
					status, _ := h.db.GetJobStatus(context.Background(), jobID)
					if status == "done" || status == "error" {
						fmt.Fprintf(w, "data: [DONE]\n\n")
						w.Flush()
						return
					}
				}
			}
		}

		// Job not active — serve historical logs from DB
		lines, _ := h.db.GetJobLogs(context.Background(), jobID)
		for _, line := range lines {
			fmt.Fprintf(w, "data: %s\n\n", line)
		}
		fmt.Fprintf(w, "data: [DONE]\n\n")
		w.Flush()
	})

	return nil
}
