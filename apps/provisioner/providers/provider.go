package providers

import "fmt"

// Region represents an available cloud region.
type Region struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ServerSize represents an available server size/type.
type ServerSize struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	CPUs         int    `json:"cpus"`
	MemoryGB     float64 `json:"memory_gb"`
	DiskGB       int    `json:"disk_gb"`
	PriceMonthly string `json:"price_monthly"`
}

// TestToken validates a provider API token.
func TestToken(providerType, token string) error {
	switch providerType {
	case "hetzner":
		return TestHetznerToken(token)
	case "digitalocean":
		return TestDigitalOceanToken(token)
	case "custom":
		return nil
	default:
		return fmt.Errorf("unknown provider type: %s", providerType)
	}
}

// ListRegions returns regions available for the given provider.
func ListRegions(providerType, token string) ([]Region, error) {
	switch providerType {
	case "hetzner":
		return ListHetznerLocations(token)
	case "digitalocean":
		return ListDigitalOceanRegions(token)
	case "custom":
		return []Region{}, nil
	default:
		return nil, fmt.Errorf("unknown provider type: %s", providerType)
	}
}

// ListServerSizes returns available sizes/plans for the given provider and region.
func ListServerSizes(providerType, token, region string) ([]ServerSize, error) {
	switch providerType {
	case "hetzner":
		return ListHetznerServerTypes(token, region)
	case "digitalocean":
		return ListDigitalOceanSizes(token, region)
	case "custom":
		return []ServerSize{}, nil
	default:
		return nil, fmt.Errorf("unknown provider type: %s", providerType)
	}
}

// EnsureSSHKey registers the public key with the provider (idempotent).
// Returns the provider-side key ID.
func EnsureSSHKey(providerType, token, name, publicKey string) (int, error) {
	switch providerType {
	case "hetzner":
		return EnsureHetznerSSHKey(token, name, publicKey)
	case "digitalocean":
		return EnsureDigitalOceanSSHKey(token, name, publicKey)
	case "custom":
		return 0, nil
	default:
		return 0, fmt.Errorf("unknown provider type: %s", providerType)
	}
}
