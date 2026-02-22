package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
}

func New(databaseURL string) (*DB, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}
	config.MaxConns = 10
	config.MinConns = 2
	config.MaxConnLifetime = time.Hour

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &DB{Pool: pool}, nil
}

func (d *DB) Close() {
	d.Pool.Close()
}

// validServerFields is the allowlist of columns that the provisioner may update.
var validServerFields = map[string]bool{
	"ipAddress":           true,
	"hostKeyFingerprint":  true,
	"provisionStatus":     true,
	"providerServerId":    true,
	"encryptedKubeconfig": true,
	"encryptedK3sToken":   true,
	"k3sInstalled":        true,
	"serverRole":          true,
}

// UpdateServerField updates a single column on the server table by serverId.
func (d *DB) UpdateServerField(ctx context.Context, serverID string, field string, value interface{}) error {
	if !validServerFields[field] {
		return fmt.Errorf("field %q is not allowed", field)
	}
	query := fmt.Sprintf(`UPDATE "server" SET "%s" = $1 WHERE "serverId" = $2`, field)
	_, err := d.Pool.Exec(ctx, query, value, serverID)
	return err
}

// UpdateServerFields updates multiple fields on the server table.
func (d *DB) UpdateServerFields(ctx context.Context, serverID string, fields map[string]interface{}) error {
	if len(fields) == 0 {
		return nil
	}
	for k := range fields {
		if !validServerFields[k] {
			return fmt.Errorf("field %q is not allowed", k)
		}
	}
	i := 1
	setClauses := ""
	args := make([]interface{}, 0, len(fields)+1)
	for k, v := range fields {
		if i > 1 {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf(`"%s" = $%d`, k, i)
		args = append(args, v)
		i++
	}
	args = append(args, serverID)
	query := fmt.Sprintf(`UPDATE "server" SET %s WHERE "serverId" = $%d`, setClauses, i)
	_, err := d.Pool.Exec(ctx, query, args...)
	return err
}

// GetServer returns select fields needed by the provisioner.
type ServerRow struct {
	ServerID              string
	Name                  string
	IPAddress             string
	HostKeyFingerprint    string
	Region                string
	ServerSize            string
	OSImage               string
	IsBYOS                bool
	K3sInstalled          bool
	EncryptedKubeconfig   string
	EncryptedK3sToken     string
	MasterServerID        string
	ServerRole            string
	CloudProviderID       string
	EncryptedAPIToken     string
	ProviderType          string
	SSHKeyID              string
}

func (d *DB) GetServer(ctx context.Context, serverID string) (*ServerRow, error) {
	row := &ServerRow{}
	err := d.Pool.QueryRow(ctx, `
		SELECT
			s."serverId",
			s."name",
			COALESCE(s."ipAddress", '') as "ipAddress",
			COALESCE(s."hostKeyFingerprint", '') as "hostKeyFingerprint",
			COALESCE(s."region", '') as "region",
			COALESCE(s."serverSize", '') as "serverSize",
			COALESCE(s."osImage", 'ubuntu-24.04') as "osImage",
			COALESCE(s."isBYOS", false) as "isBYOS",
			COALESCE(s."k3sInstalled", false) as "k3sInstalled",
			COALESCE(s."encryptedKubeconfig", '') as "encryptedKubeconfig",
			COALESCE(s."encryptedK3sToken", '') as "encryptedK3sToken",
			COALESCE(s."masterServerId", '') as "masterServerId",
			COALESCE(s."serverRole", 'master') as "serverRole",
			COALESCE(s."cloudProviderId", '') as "cloudProviderId",
			COALESCE(cp."encryptedApiToken", '') as "encryptedApiToken",
			COALESCE(cp."providerType", '') as "providerType",
			COALESCE(s."sshKeyId", '') as "sshKeyId"
		FROM "server" s
		LEFT JOIN "cloud_provider" cp ON cp."cloudProviderId" = s."cloudProviderId"
		WHERE s."serverId" = $1
	`, serverID).Scan(
		&row.ServerID,
		&row.Name,
		&row.IPAddress,
		&row.HostKeyFingerprint,
		&row.Region,
		&row.ServerSize,
		&row.OSImage,
		&row.IsBYOS,
		&row.K3sInstalled,
		&row.EncryptedKubeconfig,
		&row.EncryptedK3sToken,
		&row.MasterServerID,
		&row.ServerRole,
		&row.CloudProviderID,
		&row.EncryptedAPIToken,
		&row.ProviderType,
		&row.SSHKeyID,
	)
	if err != nil {
		return nil, fmt.Errorf("server %s not found: %w", serverID, err)
	}
	return row, nil
}

// GetSSHPrivateKey returns the (plaintext) private key for an sshKeyId.
func (d *DB) GetSSHPrivateKey(ctx context.Context, sshKeyID string) (string, error) {
	var privateKey string
	err := d.Pool.QueryRow(ctx, `SELECT "privateKey" FROM "ssh_key" WHERE "sshKeyId" = $1`, sshKeyID).Scan(&privateKey)
	if err != nil {
		return "", fmt.Errorf("ssh key %s not found: %w", sshKeyID, err)
	}
	return privateKey, nil
}

// CreateProvisionerJob inserts a new job record and returns its ID.
func (d *DB) CreateProvisionerJob(ctx context.Context, jobID, jobType, serverID string) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO "provisioner_job" ("jobId", "jobType", "serverId", "status", "createdAt")
		VALUES ($1, $2, $3, 'pending', NOW())
	`, jobID, jobType, serverID)
	return err
}

// UpdateJobStatus sets job status and optionally appends a log line.
func (d *DB) UpdateJobStatus(ctx context.Context, jobID, status string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE "provisioner_job" SET "status" = $1, "updatedAt" = NOW() WHERE "jobId" = $2
	`, status, jobID)
	return err
}

// AppendJobLog inserts a log line for a job.
func (d *DB) AppendJobLog(ctx context.Context, jobID, line string) error {
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO "provisioner_job_log" ("jobId", "line", "createdAt")
		VALUES ($1, $2, NOW())
	`, jobID, line)
	return err
}

// GetJobLogs returns all log lines for a job ordered by insertion.
func (d *DB) GetJobLogs(ctx context.Context, jobID string) ([]string, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT "line" FROM "provisioner_job_log"
		WHERE "jobId" = $1 ORDER BY "createdAt" ASC
	`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return nil, err
		}
		lines = append(lines, line)
	}
	return lines, nil
}

// GetJobStatus returns the current status of a job.
func (d *DB) GetJobStatus(ctx context.Context, jobID string) (string, error) {
	var status string
	err := d.Pool.QueryRow(ctx, `SELECT "status" FROM "provisioner_job" WHERE "jobId" = $1`, jobID).Scan(&status)
	return status, err
}
