package jobs

const (
	JobProvision          = "server.provision"
	JobDestroy            = "server.destroy"
	JobInstallK3s         = "server.install-k3s"
	JobInstallK3sWorker   = "server.install-k3s-worker"
	JobBYOSSetup          = "server.byos-setup"
)

type Job struct {
	ID       string
	Type     string
	ServerID string
	Payload  map[string]string
}
