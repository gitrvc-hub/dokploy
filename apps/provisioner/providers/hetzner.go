package providers

import (
	"context"
	"fmt"

	"github.com/hetznercloud/hcloud-go/v2/hcloud"
)

func hetznerClient(token string) *hcloud.Client {
	return hcloud.NewClient(hcloud.WithToken(token))
}

// TestHetznerToken validates the API token by listing servers.
func TestHetznerToken(token string) error {
	client := hetznerClient(token)
	_, _, err := client.Server.List(context.Background(), hcloud.ServerListOpts{ListOpts: hcloud.ListOpts{PerPage: 1}})
	if err != nil {
		return fmt.Errorf("invalid Hetzner API token: %w", err)
	}
	return nil
}

// ListHetznerLocations returns all Hetzner datacenter locations.
func ListHetznerLocations(token string) ([]Region, error) {
	client := hetznerClient(token)
	locations, _, err := client.Location.List(context.Background(), hcloud.LocationListOpts{})
	if err != nil {
		return nil, fmt.Errorf("failed to list Hetzner locations: %w", err)
	}
	regions := make([]Region, 0, len(locations))
	for _, l := range locations {
		regions = append(regions, Region{
			ID:   l.Name,
			Name: fmt.Sprintf("%s (%s, %s)", l.Description, l.City, l.Country),
		})
	}
	return regions, nil
}

// ListHetznerServerTypes returns all server types available at a location.
func ListHetznerServerTypes(token, region string) ([]ServerSize, error) {
	client := hetznerClient(token)
	types, _, err := client.ServerType.List(context.Background(), hcloud.ServerTypeListOpts{})
	if err != nil {
		return nil, fmt.Errorf("failed to list Hetzner server types: %w", err)
	}
	sizes := make([]ServerSize, 0, len(types))
	for _, t := range types {
		price := ""
		for _, p := range t.Pricings {
			if p.Location != nil && p.Location.Name == region {
				price = fmt.Sprintf("€%.2f/mo", p.Monthly.Gross)
				break
			}
		}
		sizes = append(sizes, ServerSize{
			ID:           t.Name,
			Name:         fmt.Sprintf("%s (%.0f GB RAM, %d vCPU, %d GB disk)", t.Name, t.Memory, t.Cores, t.Disk),
			CPUs:         t.Cores,
			MemoryGB:     float64(t.Memory),
			DiskGB:       t.Disk,
			PriceMonthly: price,
		})
	}
	return sizes, nil
}

// EnsureHetznerSSHKey registers a public key with Hetzner, returning its ID.
// Idempotent — returns the existing key ID if already registered.
func EnsureHetznerSSHKey(token, name, publicKey string) (int, error) {
	client := hetznerClient(token)

	// Try to create the key first.
	key, _, err := client.SSHKey.Create(context.Background(), hcloud.SSHKeyCreateOpts{
		Name:      name,
		PublicKey: publicKey,
	})
	if err == nil {
		return int(key.ID), nil
	}

	// If already exists, look it up by public key.
	keys, _, listErr := client.SSHKey.List(context.Background(), hcloud.SSHKeyListOpts{})
	if listErr != nil {
		return 0, fmt.Errorf("failed to list SSH keys: %w", listErr)
	}
	for _, k := range keys {
		if k.PublicKey == publicKey {
			return int(k.ID), nil
		}
	}
	return 0, fmt.Errorf("SSH key conflict but key not found: %w", err)
}
