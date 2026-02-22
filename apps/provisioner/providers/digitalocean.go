package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const doBaseURL = "https://api.digitalocean.com/v2"

func doGet(token, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, doBaseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("DigitalOcean API error %d: %s", resp.StatusCode, string(body))
	}
	return json.Unmarshal(body, out)
}

func doPost(token, path string, payload interface{}, out interface{}) (int, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, doBaseURL+path, strings.NewReader(string(data)))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return resp.StatusCode, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return resp.StatusCode, fmt.Errorf("DigitalOcean API error %d: %s", resp.StatusCode, string(body))
	}
	if out != nil {
		return resp.StatusCode, json.Unmarshal(body, out)
	}
	return resp.StatusCode, nil
}

// TestDigitalOceanToken validates the token via the /account endpoint.
func TestDigitalOceanToken(token string) error {
	var result map[string]interface{}
	if err := doGet(token, "/account", &result); err != nil {
		return fmt.Errorf("invalid DigitalOcean API token: %w", err)
	}
	return nil
}

// ListDigitalOceanRegions returns available regions.
func ListDigitalOceanRegions(token string) ([]Region, error) {
	var result struct {
		Regions []struct {
			Slug      string `json:"slug"`
			Name      string `json:"name"`
			Available bool   `json:"available"`
		} `json:"regions"`
	}
	if err := doGet(token, "/regions?per_page=50", &result); err != nil {
		return nil, err
	}
	regions := make([]Region, 0)
	for _, r := range result.Regions {
		if r.Available {
			regions = append(regions, Region{ID: r.Slug, Name: r.Name})
		}
	}
	return regions, nil
}

// ListDigitalOceanSizes returns droplet sizes available in a region.
func ListDigitalOceanSizes(token, region string) ([]ServerSize, error) {
	var result struct {
		Sizes []struct {
			Slug        string   `json:"slug"`
			Description string   `json:"description"`
			VCPUs       int      `json:"vcpus"`
			Memory      int      `json:"memory"`
			Disk        int      `json:"disk"`
			PriceMonthly float64 `json:"price_monthly"`
			Regions     []string `json:"regions"`
		} `json:"sizes"`
	}
	if err := doGet(token, "/sizes?per_page=100", &result); err != nil {
		return nil, err
	}
	sizes := make([]ServerSize, 0)
	for _, s := range result.Sizes {
		if region != "" {
			found := false
			for _, r := range s.Regions {
				if r == region {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		sizes = append(sizes, ServerSize{
			ID:           s.Slug,
			Name:         fmt.Sprintf("%s (%d vCPU, %d MB RAM, %d GB disk)", s.Slug, s.VCPUs, s.Memory, s.Disk),
			CPUs:         s.VCPUs,
			MemoryGB:     float64(s.Memory) / 1024,
			DiskGB:       s.Disk,
			PriceMonthly: fmt.Sprintf("$%.2f/mo", s.PriceMonthly),
		})
	}
	return sizes, nil
}

// EnsureDigitalOceanSSHKey registers a public key, returning its ID.
func EnsureDigitalOceanSSHKey(token, name, publicKey string) (int, error) {
	payload := map[string]string{"name": name, "public_key": publicKey}
	var result struct {
		SSHKey struct {
			ID int `json:"id"`
		} `json:"ssh_key"`
	}
	statusCode, err := doPost(token, "/account/keys", payload, &result)
	if err == nil {
		return result.SSHKey.ID, nil
	}
	if statusCode == 422 {
		// Key already exists — find it by listing
		var list struct {
			SSHKeys []struct {
				ID        int    `json:"id"`
				PublicKey string `json:"public_key"`
			} `json:"ssh_keys"`
		}
		if listErr := doGet(token, "/account/keys?per_page=100", &list); listErr != nil {
			return 0, listErr
		}
		for _, k := range list.SSHKeys {
			if k.PublicKey == publicKey {
				return k.ID, nil
			}
		}
	}
	return 0, fmt.Errorf("failed to ensure SSH key: %w", err)
}
