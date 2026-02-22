package ssh

import (
	"crypto/md5"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// Client wraps an SSH connection with TOFU host key verification.
type Client struct {
	client *ssh.Client
}

// Connect establishes an SSH connection.
// If knownFingerprint is empty, accepts any host key and returns the observed fingerprint.
// If knownFingerprint is set, verifies the host key and returns an error on mismatch.
func Connect(host, port, user, privateKeyPEM, knownFingerprint string) (*Client, string, error) {
	signer, err := ssh.ParsePrivateKey([]byte(privateKeyPEM))
	if err != nil {
		return nil, "", fmt.Errorf("failed to parse private key: %w", err)
	}

	var observedFingerprint string

	config := &ssh.ClientConfig{
		User: user,
		Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			fp := fingerprintMD5(key)
			observedFingerprint = fp
			if knownFingerprint == "" {
				return nil // TOFU: accept and remember
			}
			if fp != knownFingerprint {
				return fmt.Errorf("host key mismatch: got %s, expected %s (possible MITM)", fp, knownFingerprint)
			}
			return nil
		},
		Timeout: 30 * time.Second,
	}

	addr := net.JoinHostPort(host, port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, "", fmt.Errorf("SSH dial %s: %w", addr, err)
	}

	return &Client{client: client}, observedFingerprint, nil
}

// Close closes the SSH connection.
func (c *Client) Close() {
	c.client.Close()
}

// Run executes a command on the remote host, streaming output via onLine.
func (c *Client) Run(command string, onLine func(string)) error {
	session, err := c.client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	pr, pw, err := os.Pipe()
	if err != nil {
		return err
	}
	session.Stdout = pw
	session.Stderr = pw

	if err := session.Start(command); err != nil {
		pw.Close()
		pr.Close()
		return fmt.Errorf("command start: %w", err)
	}
	pw.Close()

	buf := make([]byte, 4096)
	line := ""
	for {
		n, readErr := pr.Read(buf)
		if n > 0 {
			for _, ch := range string(buf[:n]) {
				if ch == '\n' {
					if onLine != nil {
						onLine(strings.TrimRight(line, "\r"))
					}
					line = ""
				} else {
					line += string(ch)
				}
			}
		}
		if readErr != nil {
			break
		}
	}
	if line != "" && onLine != nil {
		onLine(strings.TrimRight(line, "\r"))
	}
	pr.Close()

	return session.Wait()
}

// RunOutput executes a command and returns combined stdout+stderr as a string.
func (c *Client) RunOutput(command string) (string, error) {
	var lines []string
	err := c.Run(command, func(line string) {
		lines = append(lines, line)
	})
	return strings.Join(lines, "\n"), err
}

// Upload writes content to a remote file path via stdin redirection.
func (c *Client) Upload(content, remotePath string) error {
	session, err := c.client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	session.Stdin = strings.NewReader(content)
	return session.Run(fmt.Sprintf("cat > %s", remotePath))
}

func fingerprintMD5(key ssh.PublicKey) string {
	hash := md5.Sum(key.Marshal())
	parts := make([]string, len(hash))
	for i, b := range hash {
		parts[i] = fmt.Sprintf("%02x", b)
	}
	return strings.Join(parts, ":")
}
