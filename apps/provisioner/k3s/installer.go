package k3s

import (
	"context"
	"fmt"
	"strings"
	"time"

	gossh "github.com/dokploy/provisioner/ssh"
)

// Installer handles K3s installation on a remote server via SSH.
type Installer struct {
	host        string
	user        string
	privateKey  string
	fingerprint string
}

func New(host, user, privateKey, fingerprint string) *Installer {
	return &Installer{
		host:        host,
		user:        user,
		privateKey:  privateKey,
		fingerprint: fingerprint,
	}
}

// InstallMaster installs K3s as a master node.
// Returns the kubeconfig (with public IP), K3s node token, and the observed host key fingerprint.
func (i *Installer) InstallMaster(ctx context.Context, onLog func(string)) (kubeconfig, k3sToken, fingerprint string, err error) {
	client, fp, err := i.connect(onLog)
	if err != nil {
		return "", "", "", err
	}
	defer client.Close()

	log := func(msg string) {
		onLog(msg)
	}

	log("==> Waiting for cloud-init to complete...")
	_ = client.Run("cloud-init status --wait 2>/dev/null || true", func(line string) { log(line) })

	log("==> Configuring firewall...")
	if err := client.Run(`
		ufw allow 22/tcp
		ufw allow 80/tcp
		ufw allow 443/tcp
		ufw allow 6443/tcp
		ufw allow 5000/tcp
		ufw allow 10250/tcp
		ufw allow 8472/udp
		ufw --force enable
	`, func(line string) { log(line) }); err != nil {
		log(fmt.Sprintf("Warning: firewall setup: %v", err))
	}

	log("==> Installing Docker...")
	if err := client.Run("curl -fsSL https://get.docker.com | sh", func(line string) { log(line) }); err != nil {
		return "", "", "", fmt.Errorf("docker install failed: %w", err)
	}

	log("==> Installing Nixpacks...")
	if err := client.Run("curl -sSL https://nixpacks.com/install.sh | bash", func(line string) { log(line) }); err != nil {
		log(fmt.Sprintf("Warning: nixpacks install: %v", err))
	}

	log("==> Starting local Docker registry...")
	_ = client.Run("docker run -d --restart=always -p 5000:5000 --name registry registry:2 2>/dev/null || true", func(line string) { log(line) })

	log("==> Installing K3s...")
	if err := client.Run(`curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --docker" sh -`, func(line string) { log(line) }); err != nil {
		return "", "", "", fmt.Errorf("K3s install failed: %w", err)
	}

	log("==> Waiting for K3s to be ready...")
	if err := waitForK3s(client, log); err != nil {
		return "", "", "", err
	}

	log("==> Extracting kubeconfig...")
	rawKubeconfig, err := client.RunOutput("cat /etc/rancher/k3s/k3s.yaml")
	if err != nil {
		return "", "", "", fmt.Errorf("failed to read kubeconfig: %w", err)
	}
	kubeconfig = strings.ReplaceAll(rawKubeconfig, "127.0.0.1", i.host)
	kubeconfig = strings.ReplaceAll(kubeconfig, "localhost", i.host)

	log("==> Extracting K3s node token...")
	k3sToken, err = client.RunOutput("cat /var/lib/rancher/k3s/server/node-token")
	if err != nil {
		return "", "", "", fmt.Errorf("failed to read node token: %w", err)
	}
	k3sToken = strings.TrimSpace(k3sToken)

	log("==> Installing cert-manager...")
	if err := client.Run(
		"kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml",
		func(line string) { log(line) },
	); err != nil {
		return "", "", "", fmt.Errorf("cert-manager install failed: %w", err)
	}

	log("==> Waiting for cert-manager pods...")
	_ = client.Run("kubectl wait --for=condition=Ready pods --all -n cert-manager --timeout=300s", func(line string) { log(line) })

	log("==> Installing metrics-server...")
	if err := client.Run(
		"kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml",
		func(line string) { log(line) },
	); err != nil {
		log(fmt.Sprintf("Warning: metrics-server install: %v", err))
	}
	_ = client.Run(
		`kubectl patch deployment metrics-server -n kube-system --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'`,
		func(line string) { log(line) },
	)

	log("==> Creating Let's Encrypt ClusterIssuer...")
	if err := createClusterIssuer(client, log); err != nil {
		log(fmt.Sprintf("Warning: ClusterIssuer: %v", err))
	}

	log("==> K3s master installation complete!")
	return kubeconfig, k3sToken, fp, nil
}

// InstallWorker joins an existing K3s cluster as a worker node.
func (i *Installer) InstallWorker(ctx context.Context, masterIP, masterToken string, onLog func(string)) (fingerprint string, err error) {
	client, fp, err := i.connect(onLog)
	if err != nil {
		return "", err
	}
	defer client.Close()

	log := func(msg string) { onLog(msg) }

	log("==> Waiting for cloud-init...")
	_ = client.Run("cloud-init status --wait 2>/dev/null || true", func(line string) { log(line) })

	log("==> Installing Docker...")
	if err := client.Run("curl -fsSL https://get.docker.com | sh", func(line string) { log(line) }); err != nil {
		return "", fmt.Errorf("docker install failed: %w", err)
	}

	log("==> Installing Nixpacks...")
	_ = client.Run("curl -sSL https://nixpacks.com/install.sh | bash", func(line string) { log(line) })

	log("==> Joining K3s cluster...")
	joinCmd := fmt.Sprintf(
		`curl -sfL https://get.k3s.io | K3S_URL=https://%s:6443 K3S_TOKEN=%s INSTALL_K3S_EXEC="agent --docker" sh -`,
		masterIP, masterToken,
	)
	if err := client.Run(joinCmd, func(line string) { log(line) }); err != nil {
		return "", fmt.Errorf("K3s worker join failed: %w", err)
	}

	log("==> Worker node joined successfully!")
	return fp, nil
}

// BYOSPreflight runs pre-flight checks and cleans up existing installations.
func (i *Installer) BYOSPreflight(ctx context.Context, onLog func(string)) (fingerprint string, err error) {
	client, fp, err := i.connect(onLog)
	if err != nil {
		return "", err
	}
	defer client.Close()

	log := func(msg string) { onLog(msg) }

	log("==> Running pre-flight checks...")
	arch, _ := client.RunOutput("uname -m")
	log(fmt.Sprintf("Architecture: %s", strings.TrimSpace(arch)))

	osInfo, _ := client.RunOutput("cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'")
	log(fmt.Sprintf("OS: %s", strings.TrimSpace(osInfo)))

	log("==> Cleaning up existing installations...")
	cleanup := []string{
		"/usr/local/bin/k3s-uninstall.sh 2>/dev/null || true",
		"/usr/local/bin/k3s-agent-uninstall.sh 2>/dev/null || true",
		"docker stop $(docker ps -aq) 2>/dev/null || true",
		"docker rm $(docker ps -aq) 2>/dev/null || true",
	}
	for _, cmd := range cleanup {
		_ = client.Run(cmd, func(line string) { log(line) })
	}

	log("==> BYOS pre-flight complete!")
	return fp, nil
}

func (i *Installer) connect(onLog func(string)) (*gossh.Client, string, error) {
	const maxAttempts = 30
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		client, fp, err := gossh.Connect(i.host, "22", i.user, i.privateKey, i.fingerprint)
		if err == nil {
			return client, fp, nil
		}
		lastErr = err
		onLog(fmt.Sprintf("SSH attempt %d/%d failed: %v — retrying in 10s...", attempt, maxAttempts, err))
		time.Sleep(10 * time.Second)
	}
	return nil, "", fmt.Errorf("could not connect after %d attempts: %w", maxAttempts, lastErr)
}

func waitForK3s(client *gossh.Client, log func(string)) error {
	for i := 0; i < 12; i++ {
		out, err := client.RunOutput("kubectl wait --for=condition=Ready node --all --timeout=30s 2>&1")
		if err == nil {
			log(out)
			return nil
		}
		log(fmt.Sprintf("Waiting for K3s... (%d/12)", i+1))
		time.Sleep(15 * time.Second)
	}
	return fmt.Errorf("K3s did not become ready within 3 minutes")
}

func createClusterIssuer(client *gossh.Client, log func(string)) error {
	manifest := `
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@dokploy.com
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
    - http01:
        ingress:
          class: traefik
`
	if err := client.Upload(manifest, "/tmp/clusterissuer.yaml"); err != nil {
		return err
	}
	for i := 0; i < 10; i++ {
		if err := client.Run("kubectl apply -f /tmp/clusterissuer.yaml", func(line string) { log(line) }); err == nil {
			return nil
		}
		log(fmt.Sprintf("Retrying ClusterIssuer apply (%d/10)...", i+1))
		time.Sleep(15 * time.Second)
	}
	return fmt.Errorf("failed to apply ClusterIssuer after 10 attempts")
}
