package api

import (
	"net/http"
	"os"
	"runtime"
)

// handleHost reports OS-level metrics of the node (as opposed to Docker-level in
// /api/system): CPU cores + utilisation, RAM total/used, disk total/used. The
// per-metric collectors are platform-specific (see host_linux.go /
// host_windows.go / host_other.go); any value a platform can't provide is
// simply omitted from the response.
func (s *Server) handleHost(w http.ResponseWriter, _ *http.Request) {
	resp := map[string]any{"cpuCores": runtime.NumCPU()}

	if l1, l5, l15, ok := loadAvg(); ok {
		resp["load1"] = round2(l1)
		resp["load5"] = round2(l5)
		resp["load15"] = round2(l15)
	}

	// Direct CPU utilisation (0-100). Portable across platforms that lack a
	// Unix-style load average (e.g. Windows).
	if pct, ok := cpuUsedPerc(); ok {
		resp["cpuUsedPerc"] = round2(pct)
	}

	if totalMb, availMb, ok := memInfo(); ok {
		used := totalMb - availMb
		resp["memTotalMb"] = totalMb
		resp["memUsedMb"] = used
		if totalMb > 0 {
			resp["memUsedPerc"] = round2(float64(used) / float64(totalMb) * 100)
		}
	}

	path := os.Getenv("AGENT_WORKDIR")
	if path == "" {
		path = "/"
	}
	if totalGb, freeGb, ok := diskUsage(path); ok {
		used := totalGb - freeGb
		resp["diskTotalGb"] = round2(totalGb)
		resp["diskUsedGb"] = round2(used)
		if totalGb > 0 {
			resp["diskUsedPerc"] = round2(used / totalGb * 100)
		}
	}

	writeJSON(w, resp)
}
