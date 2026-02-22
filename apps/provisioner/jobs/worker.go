package jobs

import (
	"context"
	"fmt"
	"log"

	"github.com/dokploy/provisioner/db"
	"github.com/dokploy/provisioner/encrypt"
	"github.com/dokploy/provisioner/k3s"
	"github.com/dokploy/provisioner/providers"
	"github.com/dokploy/provisioner/terraform"
)

// Worker holds dependencies needed to execute all job types.
type Worker struct {
	db        *db.DB
	tf        *terraform.Executor
	queue     *Queue
	encKey    string
	tfBinPath string
}

func NewWorker(database *db.DB, tf *terraform.Executor, queue *Queue, encKey string) *Worker {
	return &Worker{db: database, tf: tf, queue: queue, encKey: encKey}
}

// Handle is the main job dispatcher.
func (w *Worker) Handle(job *Job, logger *Logger) {
	ctx := context.Background()
	var err error

	logger.Write(fmt.Sprintf("[dokploy-provisioner] Starting job %s (type=%s, server=%s)", job.ID, job.Type, job.ServerID))

	switch job.Type {
	case JobProvision:
		err = w.handleProvision(ctx, job, logger)
	case JobDestroy:
		err = w.handleDestroy(ctx, job, logger)
	case JobInstallK3s:
		err = w.handleInstallK3s(ctx, job, logger)
	case JobInstallK3sWorker:
		err = w.handleInstallK3sWorker(ctx, job, logger)
	case JobBYOSSetup:
		err = w.handleBYOSSetup(ctx, job, logger)
	default:
		err = fmt.Errorf("unknown job type: %s", job.Type)
	}

	if err != nil {
		logger.Write(fmt.Sprintf("[ERROR] %v", err))
		if dbErr := w.db.UpdateJobStatus(ctx, job.ID, "error"); dbErr != nil {
			log.Printf("failed to update job status to error: %v", dbErr)
		}
		_ = w.db.UpdateServerField(ctx, job.ServerID, "provisionStatus", "failed")
		return
	}

	if dbErr := w.db.UpdateJobStatus(ctx, job.ID, "done"); dbErr != nil {
		log.Printf("failed to update job status to done: %v", dbErr)
	}
	logger.Write("[dokploy-provisioner] Job completed successfully.")
}

func (w *Worker) handleProvision(ctx context.Context, job *Job, logger *Logger) error {
	srv, err := w.db.GetServer(ctx, job.ServerID)
	if err != nil {
		return err
	}

	// Decrypt provider API token
	apiToken, err := encrypt.Decrypt(srv.EncryptedAPIToken, w.encKey)
	if err != nil {
		return fmt.Errorf("failed to decrypt API token: %w", err)
	}

	// Get SSH private key
	sshPrivKey, err := w.db.GetSSHPrivateKey(ctx, srv.SSHKeyID)
	if err != nil {
		return fmt.Errorf("failed to get SSH key: %w", err)
	}

	// Get SSH public key for registering with provider
	sshPubKey := job.Payload["sshPublicKey"]

	_ = w.db.UpdateServerField(ctx, job.ServerID, "provisionStatus", "provisioning")
	logger.Write("==> Registering SSH key with provider...")

	cloudKeyID, err := providers.EnsureSSHKey(srv.ProviderType, apiToken, fmt.Sprintf("dokploy-%s", job.ServerID), sshPubKey)
	if err != nil {
		return fmt.Errorf("failed to register SSH key: %w", err)
	}

	logger.Write("==> Generating Terraform configuration...")
	cfg := terraform.ServerConfig{
		ServerID:      job.ServerID,
		ServerName:    srv.Name,
		Region:        srv.Region,
		Size:          srv.ServerSize,
		OS:            srv.OSImage,
		SSHKeyCloudID: cloudKeyID,
		ProviderType:  srv.ProviderType,
		ProviderToken: apiToken,
	}
	if err := w.tf.GenerateFiles(cfg); err != nil {
		return fmt.Errorf("failed to generate terraform files: %w", err)
	}

	logger.Write("==> Running terraform init...")
	if err := w.tf.Init(job.ServerID, logger.Write); err != nil {
		return fmt.Errorf("terraform init failed: %w", err)
	}

	logger.Write("==> Running terraform apply...")
	if err := w.tf.Apply(job.ServerID, logger.Write); err != nil {
		return fmt.Errorf("terraform apply failed: %w", err)
	}

	serverIP, err := w.tf.Output(job.ServerID, "server_ip")
	if err != nil {
		return fmt.Errorf("failed to get server IP: %w", err)
	}
	providerServerID, _ := w.tf.Output(job.ServerID, "provider_server_id")

	logger.Write(fmt.Sprintf("==> Server provisioned at %s", serverIP))

	if err := w.db.UpdateServerFields(ctx, job.ServerID, map[string]interface{}{
		"ipAddress":        serverIP,
		"providerServerId": providerServerID,
		"provisionStatus":  "provisioned",
		"serverStatus":     "active",
	}); err != nil {
		return fmt.Errorf("failed to update server: %w", err)
	}

	// Auto-submit K3s install job
	logger.Write("==> Submitting K3s installation job...")
	k3sJob := &Job{
		ID:       fmt.Sprintf("%s-k3s", job.ID),
		Type:     JobInstallK3s,
		ServerID: job.ServerID,
		Payload:  map[string]string{"sshPrivateKey": sshPrivKey},
	}
	if err := w.db.CreateProvisionerJob(ctx, k3sJob.ID, k3sJob.Type, job.ServerID); err != nil {
		return fmt.Errorf("failed to create K3s job: %w", err)
	}
	w.queue.Submit(k3sJob)
	return nil
}

func (w *Worker) handleInstallK3s(ctx context.Context, job *Job, logger *Logger) error {
	srv, err := w.db.GetServer(ctx, job.ServerID)
	if err != nil {
		return err
	}

	sshPrivKey := job.Payload["sshPrivateKey"]
	if sshPrivKey == "" {
		sshPrivKey, err = w.db.GetSSHPrivateKey(ctx, srv.SSHKeyID)
		if err != nil {
			return fmt.Errorf("failed to get SSH key: %w", err)
		}
	}

	installer := k3s.New(srv.IPAddress, "root", sshPrivKey, srv.HostKeyFingerprint)
	kubeconfig, k3sToken, fp, err := installer.InstallMaster(ctx, logger.Write)
	if err != nil {
		return err
	}

	encKubeconfig, err := encrypt.Encrypt(kubeconfig, w.encKey)
	if err != nil {
		return fmt.Errorf("failed to encrypt kubeconfig: %w", err)
	}
	encToken, err := encrypt.Encrypt(k3sToken, w.encKey)
	if err != nil {
		return fmt.Errorf("failed to encrypt K3s token: %w", err)
	}

	return w.db.UpdateServerFields(ctx, job.ServerID, map[string]interface{}{
		"k3sInstalled":        true,
		"encryptedKubeconfig": encKubeconfig,
		"encryptedK3sToken":   encToken,
		"hostKeyFingerprint":  fp,
	})
}

func (w *Worker) handleInstallK3sWorker(ctx context.Context, job *Job, logger *Logger) error {
	srv, err := w.db.GetServer(ctx, job.ServerID)
	if err != nil {
		return err
	}

	// Get master server for K3s token
	master, err := w.db.GetServer(ctx, srv.MasterServerID)
	if err != nil {
		return fmt.Errorf("failed to get master server: %w", err)
	}

	masterToken, err := encrypt.Decrypt(master.EncryptedK3sToken, w.encKey)
	if err != nil {
		return fmt.Errorf("failed to decrypt master K3s token: %w", err)
	}

	sshPrivKey, err := w.db.GetSSHPrivateKey(ctx, srv.SSHKeyID)
	if err != nil {
		return fmt.Errorf("failed to get SSH key: %w", err)
	}

	installer := k3s.New(srv.IPAddress, "root", sshPrivKey, srv.HostKeyFingerprint)
	fp, err := installer.InstallWorker(ctx, master.IPAddress, masterToken, logger.Write)
	if err != nil {
		return err
	}

	return w.db.UpdateServerFields(ctx, job.ServerID, map[string]interface{}{
		"k3sInstalled":       true,
		"hostKeyFingerprint": fp,
	})
}

func (w *Worker) handleBYOSSetup(ctx context.Context, job *Job, logger *Logger) error {
	srv, err := w.db.GetServer(ctx, job.ServerID)
	if err != nil {
		return err
	}

	sshPrivKey, err := w.db.GetSSHPrivateKey(ctx, srv.SSHKeyID)
	if err != nil {
		return fmt.Errorf("failed to get SSH key: %w", err)
	}

	_ = w.db.UpdateServerField(ctx, job.ServerID, "provisionStatus", "provisioning")

	installer := k3s.New(srv.IPAddress, "root", sshPrivKey, srv.HostKeyFingerprint)
	fp, err := installer.BYOSPreflight(context.Background(), logger.Write)
	if err != nil {
		return err
	}

	if err := w.db.UpdateServerFields(ctx, job.ServerID, map[string]interface{}{
		"provisionStatus":    "provisioned",
		"serverStatus":       "active",
		"hostKeyFingerprint": fp,
	}); err != nil {
		return err
	}

	// Auto-submit K3s install
	k3sJob := &Job{
		ID:       fmt.Sprintf("%s-k3s", job.ID),
		Type:     JobInstallK3s,
		ServerID: job.ServerID,
		Payload:  map[string]string{},
	}
	if err := w.db.CreateProvisionerJob(ctx, k3sJob.ID, k3sJob.Type, job.ServerID); err != nil {
		return fmt.Errorf("failed to create K3s job: %w", err)
	}
	w.queue.Submit(k3sJob)
	return nil
}

func (w *Worker) handleDestroy(ctx context.Context, job *Job, logger *Logger) error {
	srv, err := w.db.GetServer(ctx, job.ServerID)
	if err != nil {
		return err
	}

	_ = w.db.UpdateServerField(ctx, job.ServerID, "provisionStatus", "destroying")

	if !srv.IsBYOS && srv.EncryptedAPIToken != "" {
		apiToken, err := encrypt.Decrypt(srv.EncryptedAPIToken, w.encKey)
		if err != nil {
			return fmt.Errorf("failed to decrypt API token: %w", err)
		}
		sshPubKey := job.Payload["sshPublicKey"]
		cfg := terraform.ServerConfig{
			ServerID:      job.ServerID,
			ServerName:    srv.Name,
			Region:        srv.Region,
			Size:          srv.ServerSize,
			OS:            srv.OSImage,
			ProviderType:  srv.ProviderType,
			ProviderToken: apiToken,
		}
		// Re-register SSH key to get cloudKeyID for template rendering
		cloudKeyID, _ := providers.EnsureSSHKey(srv.ProviderType, apiToken, fmt.Sprintf("dokploy-%s", job.ServerID), sshPubKey)
		cfg.SSHKeyCloudID = cloudKeyID

		if err := w.tf.GenerateFiles(cfg); err != nil {
			logger.Write(fmt.Sprintf("Warning: could not regenerate terraform files: %v", err))
		} else {
			logger.Write("==> Running terraform destroy...")
			if err := w.tf.Destroy(job.ServerID, logger.Write); err != nil {
				logger.Write(fmt.Sprintf("Warning: terraform destroy error (server may already be gone): %v", err))
			}
			_ = w.tf.Cleanup(job.ServerID)
		}
	}

	_ = w.db.UpdateServerField(ctx, job.ServerID, "provisionStatus", "destroyed")
	logger.Write("==> Server destroyed.")
	return nil
}
