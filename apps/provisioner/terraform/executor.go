package terraform

import (
	"bytes"
	"embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"text/template"
)

//go:embed templates/*.tmpl
var templateFS embed.FS

// ServerConfig holds all values needed to render Terraform templates.
type ServerConfig struct {
	ServerID      string
	ServerName    string
	Region        string
	Size          string
	OS            string
	SSHKeyCloudID int
	ProviderType  string
	ProviderToken string
}

// Executor runs Terraform commands in per-server workdirs.
type Executor struct {
	workDir     string
	tfBinaryPath string
}

func New(workDir, tfBinaryPath string) *Executor {
	return &Executor{workDir: workDir, tfBinaryPath: tfBinaryPath}
}

func (e *Executor) serverDir(serverID string) string {
	return filepath.Join(e.workDir, serverID)
}

// GenerateFiles renders the provider .tf and cloud-init.yml files into the server workdir.
func (e *Executor) GenerateFiles(cfg ServerConfig) error {
	dir := e.serverDir(cfg.ServerID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create workdir: %w", err)
	}

	// Render provider .tf file
	tmplName := fmt.Sprintf("templates/%s.tf.tmpl", cfg.ProviderType)
	tfContent, err := renderTemplate(tmplName, cfg)
	if err != nil {
		return fmt.Errorf("failed to render %s: %w", tmplName, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.tf"), []byte(tfContent), 0644); err != nil {
		return err
	}

	// Render cloud-init
	ciContent, err := renderTemplate("templates/cloud-init.yml.tmpl", cfg)
	if err != nil {
		return fmt.Errorf("failed to render cloud-init: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "cloud-init.yml"), []byte(ciContent), 0644); err != nil {
		return err
	}

	return nil
}

// Init runs `terraform init` in the server workdir.
func (e *Executor) Init(serverID string, onLog func(string)) error {
	return e.run(serverID, onLog, "init", "-no-color")
}

// Apply runs `terraform apply -auto-approve`.
func (e *Executor) Apply(serverID string, onLog func(string)) error {
	return e.run(serverID, onLog, "apply", "-auto-approve", "-no-color")
}

// Destroy runs `terraform destroy -auto-approve`.
func (e *Executor) Destroy(serverID string, onLog func(string)) error {
	return e.run(serverID, onLog, "destroy", "-auto-approve", "-no-color")
}

// Output reads a named output from the terraform state.
func (e *Executor) Output(serverID, key string) (string, error) {
	dir := e.serverDir(serverID)
	cmd := exec.Command(e.tfBinaryPath, "output", "-raw", "-no-color", key)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("terraform output %s: %w", key, err)
	}
	return string(bytes.TrimSpace(out)), nil
}

// Cleanup removes the server workdir.
func (e *Executor) Cleanup(serverID string) error {
	return os.RemoveAll(e.serverDir(serverID))
}

func (e *Executor) run(serverID string, onLog func(string), args ...string) error {
	dir := e.serverDir(serverID)
	cmd := exec.Command(e.tfBinaryPath, args...)
	cmd.Dir = dir

	// Stream combined stdout+stderr line by line via a pipe.
	pr, pw, err := os.Pipe()
	if err != nil {
		return err
	}
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		return fmt.Errorf("terraform start: %w", err)
	}
	pw.Close()

	buf := make([]byte, 4096)
	line := ""
	for {
		n, err := pr.Read(buf)
		if n > 0 {
			for _, ch := range string(buf[:n]) {
				if ch == '\n' {
					if line != "" && onLog != nil {
						onLog(line)
					}
					line = ""
				} else {
					line += string(ch)
				}
			}
		}
		if err != nil {
			break
		}
	}
	if line != "" && onLog != nil {
		onLog(line)
	}
	pr.Close()

	return cmd.Wait()
}

func renderTemplate(name string, data interface{}) (string, error) {
	content, err := templateFS.ReadFile(name)
	if err != nil {
		return "", err
	}
	tmpl, err := template.New(name).Parse(string(content))
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}
